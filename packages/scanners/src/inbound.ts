// inbound helpers: extract scan token from multiple header fields
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

import {
  parseAuthenticationResults,
  extractTlsFromReceived,
  extractReturnPathDomain,
  computeApexAlignment,
} from "./emailVerification.js";

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

type SpfResult = "pass" | "fail" | "softfail" | "neutral" | "temperror" | "permerror" | "none";

/**
 * Orchestrate all signals from parsed headers into email_scan.checks shape.
 */
export function buildEmailScanChecks(
  headers: { single: Record<string, string>; received: string[] },
  fromEmail: string,
  existingDns?: { dmarc?: { policy?: string; pct?: number | null } }
): {
  spf: { present: boolean; result: string; alignment: "aligned" | "not_aligned" | "unknown" };
  dkim: { present: boolean; result: "pass" | "fail" | "unknown"; alignment: "aligned" | "not_aligned" | "unknown"; selectors_checked: string[] };
  dmarc: { present: boolean; policy: "none" | "quarantine" | "reject" | "unknown"; pct: number; alignment_mode: "relaxed" | "strict" | "unknown" };
  mx: { tls: { supported: boolean } };
} {
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

  // DMARC
  const dmarcResult = auth.dmarc?.result ?? "none";
  const dmarcPresent = dmarcResult !== "none";

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

  // MX TLS
  const tlsSupported = extractTlsFromReceived(headers.received) ?? false;

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
    },
    dmarc: {
      present: dmarcPresent,
      policy: dmarcPolicy,
      pct: dmarcPct,
      alignment_mode: "unknown",
    },
    mx: {
      tls: { supported: tlsSupported },
    },
  };
}
