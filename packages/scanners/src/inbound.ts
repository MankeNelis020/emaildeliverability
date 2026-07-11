// inbound helpers: extract scan token from multiple header fields

import { resolveTxt as dnsResolveTxt } from "node:dns/promises";

import {
  parseAuthenticationResults,
  extractTlsFromReceived,
  extractReturnPathDomain,
  computeApexAlignment,
} from "./emailVerification.js";

export function extractScanTokenFromRecipient(headers: Record<string, string>, inboundDomain: string): string | null {
  const candidates = [
    headers["delivered-to"],
    headers["to"],
    headers["x-original-to"],
    headers["envelope-to"],
    headers["received"],
  ].filter(Boolean) as string[];

  const joined = candidates.join("\n").toLowerCase();
  const dom = inboundDomain.toLowerCase().replace(".", "\\.");

  const m = joined.match(new RegExp(`verify\\+([a-z0-9._-]+)@${dom}`, "i"));
  return m?.[1] ?? null;
}

/**
 * Parse Mailgun's message-headers JSON field.
 * Input: JSON string like [["Received","..."],["Authentication-Results","..."],...]
 * Received headers are collected in order; all other headers: last-write-wins for duplicates.
 */
export function parseMailgunHeaders(messageHeadersJson: string): {
  single: Record<string, string>;
  received: string[];
} {
  let raw: [string, string][];
  try {
    raw = JSON.parse(messageHeadersJson);
  } catch {
    return { single: {}, received: [] };
  }

  if (!Array.isArray(raw)) return { single: {}, received: [] };

  const single: Record<string, string> = {};
  const received: string[] = [];

  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const name = String(entry[0]).toLowerCase();
    const value = String(entry[1]);

    if (name === "received") {
      received.push(value);
    } else {
      single[name] = value;
    }
  }

  return { single, received };
}

/**
 * Parse adkim/aspf alignment modes from a raw DMARC record string.
 * Defaults to "relaxed" per RFC 7489 if the tag is absent.
 */
export function parseDmarcAlignmentModes(dmarcRecord: string | null | undefined): {
  adkim: "relaxed" | "strict" | "unknown";
  aspf: "relaxed" | "strict" | "unknown";
} {
  if (!dmarcRecord) return { adkim: "unknown", aspf: "unknown" };
  const adkim = dmarcRecord.match(/\badkim\s*=\s*(r|s)\b/i)?.[1]?.toLowerCase();
  const aspf = dmarcRecord.match(/\baspf\s*=\s*(r|s)\b/i)?.[1]?.toLowerCase();
  return {
    adkim: adkim === "s" ? "strict" : adkim === "r" ? "relaxed" : "relaxed", // default is relaxed per RFC 7489
    aspf: aspf === "s" ? "strict" : aspf === "r" ? "relaxed" : "relaxed",
  };
}

/**
 * Resolve a DKIM selector's public key from DNS and estimate key bit size.
 */
export async function resolveDkimKeyBits(
  selector: string | null | undefined,
  domain: string | null | undefined
): Promise<number | null> {
  if (!selector || !domain) return null;
  try {
    const host = `${selector}._domainkey.${domain}`;
    const raw = await dnsResolveTxt(host);
    const record = raw.map(chunks => chunks.join("")).find(r => r.includes("p="));
    if (!record) return null;
    const pMatch = record.match(/\bp=([A-Za-z0-9+/=]+)/);
    if (!pMatch?.[1]) return null;
    const bytes = Buffer.from(pMatch[1], "base64").length;
    // Heuristic: RSA 1024 ≈ 140-162 bytes, 2048 ≈ 270-294 bytes, 4096 ≈ 550+ bytes
    if (bytes < 180) return 1024;
    if (bytes < 400) return 2048;
    return 4096;
  } catch {
    return null;
  }
}

/**
 * Derive an overall DMARC pass/fail/unknown result from SPF and DKIM signals.
 */
export function deriveDmarcResult(
  spfResult: string | null | undefined,
  spfAlignment: string | null | undefined,
  dkimResult: string | null | undefined,
  dkimAlignment: string | null | undefined
): "pass" | "fail" | "unknown" {
  const spfPass = spfResult === "pass" && spfAlignment === "aligned";
  const dkimPass = (dkimResult === "pass") && dkimAlignment === "aligned";
  if (spfPass || dkimPass) return "pass";
  const anyKnown = (spfResult && spfResult !== "unknown") || (dkimResult && dkimResult !== "unknown");
  if (anyKnown) return "fail";
  return "unknown";
}

export type MicrosoftFilterVerdict = "inbox" | "junk" | "spam" | "bypassed" | "unknown";

export type MicrosoftFilter = {
  present: boolean;
  scl: number | null;
  bcl: number | null;
  verdict: MicrosoftFilterVerdict;
  cat: string | null;
};

/**
 * Parse Microsoft's X-Forefront-Antispam-Report header.
 */
export function parseMicrosoftFilter(header: string | null | undefined): MicrosoftFilter | null {
  if (!header) return null;
  const h = String(header);

  const sclMatch = h.match(/\bSCL:(-?\d+)/i);
  const bclMatch = h.match(/\bBCL:(\d+)/i);
  const catMatch = h.match(/\bCAT:([A-Z0-9_]+)/i);

  const scl = sclMatch ? parseInt(sclMatch[1], 10) : null;
  const bcl = bclMatch ? parseInt(bclMatch[1], 10) : null;
  const cat = catMatch ? catMatch[1] : null;

  let verdict: MicrosoftFilterVerdict = "unknown";
  if (scl !== null) {
    if (scl === -1) verdict = "bypassed";
    else if (scl <= 4) verdict = "inbox";
    else if (scl <= 6) verdict = "junk";
    else verdict = "spam";
  }

  return { present: true, scl, bcl, verdict, cat };
}

type SpfResult = "pass" | "fail" | "softfail" | "neutral" | "temperror" | "permerror" | "none";

/**
 * Orchestrate all signals from parsed headers into email_scan.checks shape.
 */
export async function buildEmailScanChecks(
  headers: { single: Record<string, string>; received: string[] },
  fromEmail: string,
  existingDns?: { dmarc?: { policy?: string; pct?: number | null; record?: string | null } }
): Promise<{
  spf: { present: boolean; result: string; alignment: "aligned" | "not_aligned" | "unknown" };
  dkim: { present: boolean; result: "pass" | "fail" | "unknown"; alignment: "aligned" | "not_aligned" | "unknown"; selectors_checked: string[]; key_bits: number | null };
  dmarc: { present: boolean; policy: string; pct: number; adkim: "relaxed" | "strict" | "unknown"; aspf: "relaxed" | "strict" | "unknown"; result: "pass" | "fail" | "unknown" };
  mx: { tls: { supported: boolean } };
  return_path: { domain: string | null; alignment: "aligned" | "not_aligned" | "unknown" };
  microsoft_filter: MicrosoftFilter | null;
}> {
  const authHeader = headers.single["authentication-results"] ?? null;
  const auth = parseAuthenticationResults(authHeader);

  // Extract From domain
  const fromDomain = (() => {
    const m = fromEmail.match(/@([^\s>]+)/);
    return m ? m[1].toLowerCase().replace(/\.+$/, "") : null;
  })();

  // SPF
  const spfResult: SpfResult = auth.spf?.result ?? "none";
  const spfPresent = spfResult !== "none";
  const spfDomain = auth.spf?.domain ?? extractReturnPathDomain(headers.single["return-path"] ?? null);
  const spfAlignment: "aligned" | "not_aligned" | "unknown" =
    computeApexAlignment(spfDomain, fromDomain) ?? "unknown";

  // DKIM
  const dkimRawResult = auth.dkim?.result ?? "none";
  const dkimPresent = dkimRawResult !== "none";
  const dkimResult: "pass" | "fail" | "unknown" =
    dkimRawResult === "pass" ? "pass"
    : dkimRawResult === "fail" ? "fail"
    : dkimRawResult === "none" ? "unknown"
    : "unknown"; // temperror/permerror → "unknown"
  const dkimDomain = auth.dkim?.domain ?? null;
  const dkimAlignment: "aligned" | "not_aligned" | "unknown" =
    computeApexAlignment(dkimDomain, fromDomain) ?? "unknown";
  const selectorsChecked: string[] = auth.dkim?.selector ? [auth.dkim.selector] : [];

  // Resolve DKIM key bits from DNS
  const keyBits = await resolveDkimKeyBits(auth.dkim?.selector, auth.dkim?.domain);

  // DMARC
  const dmarcRawResult = auth.dmarc?.result ?? "none";
  const dmarcPresent = dmarcRawResult !== "none";

  const rawDmarcPolicy =
    existingDns?.dmarc?.policy ??
    auth.dmarc?.policy ??
    null;

  const VALID_DMARC_POLICIES = ["none", "quarantine", "reject"] as const;
  type DmarcPolicy = "none" | "quarantine" | "reject" | "unknown";
  const dmarcPolicy: DmarcPolicy =
    rawDmarcPolicy && (VALID_DMARC_POLICIES as readonly string[]).includes(rawDmarcPolicy)
      ? (rawDmarcPolicy as "none" | "quarantine" | "reject")
      : "unknown";

  const dmarcPct: number =
    typeof existingDns?.dmarc?.pct === "number"
      ? existingDns.dmarc.pct
      : 100;

  // Parse DMARC alignment modes from DNS record
  const dmarcRecord = existingDns?.dmarc?.record ?? null;
  const { adkim, aspf } = parseDmarcAlignmentModes(dmarcRecord);

  // Derive DMARC result
  const dmarcDerivedResult = deriveDmarcResult(
    spfResult === "none" ? null : spfResult,
    spfAlignment === "unknown" ? null : spfAlignment,
    dkimResult === "unknown" ? null : dkimResult,
    dkimAlignment === "unknown" ? null : dkimAlignment
  );

  // MX TLS
  const tlsSupported = extractTlsFromReceived(headers.received) ?? false;

  // Return-Path
  const returnPathDomain = extractReturnPathDomain(headers.single["return-path"] ?? null);
  const returnPathAlignment: "aligned" | "not_aligned" | "unknown" =
    computeApexAlignment(returnPathDomain, fromDomain) ?? "unknown";

  // Microsoft filter
  const microsoftFilter = parseMicrosoftFilter(headers.single["x-forefront-antispam-report"]);

  return {
    spf: {
      present: spfPresent,
      result: spfResult,
      alignment: spfAlignment,
    },
    dkim: {
      present: dkimPresent,
      result: dkimResult,
      alignment: dkimAlignment,
      selectors_checked: selectorsChecked,
      key_bits: keyBits,
    },
    dmarc: {
      present: dmarcPresent,
      policy: dmarcPolicy,
      pct: dmarcPct,
      adkim,
      aspf,
      result: dmarcDerivedResult,
    },
    mx: {
      tls: { supported: tlsSupported },
    },
    return_path: {
      domain: returnPathDomain,
      alignment: returnPathAlignment,
    },
    microsoft_filter: microsoftFilter,
  };
}
