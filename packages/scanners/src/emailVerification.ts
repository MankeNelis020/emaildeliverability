// emailVerification.ts — inbound signal extraction helpers

export type ParsedAuth = {
  dkim?: { result: "pass" | "fail" | "temperror" | "permerror" | "none"; domain?: string; selector?: string };
  spf?: { result: "pass" | "fail" | "softfail" | "neutral" | "temperror" | "permerror" | "none"; domain?: string; ip?: string };
  dmarc?: { result: "pass" | "fail" | "none"; policy?: string };
};

// narrow<T>: return value only if it's in the allowed set, else fallback
function narrow<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const DKIM_RESULTS = ["pass", "fail", "temperror", "permerror", "none"] as const;
const SPF_RESULTS = ["pass", "fail", "softfail", "neutral", "temperror", "permerror", "none"] as const;
const DMARC_RESULTS = ["pass", "fail", "none"] as const;

export function parseAuthenticationResults(header: string | null | undefined): ParsedAuth {
  const h = String(header ?? "");
  if (!h) return {};

  const out: ParsedAuth = {};

  // DKIM
  const dkimMatch = h.match(/\bdkim=([a-zA-Z]+)/i);
  const dkimRaw = dkimMatch ? dkimMatch[1].toLowerCase() : "none";
  const dkimResult = narrow(dkimRaw, DKIM_RESULTS, "none");
  out.dkim = { result: dkimResult };
  const dkimDomain = h.match(/\bheader\.d=([^\s;,]+)/i)?.[1];
  const dkimSel = h.match(/\bheader\.s=([^\s;,]+)/i)?.[1];
  if (dkimDomain) out.dkim.domain = dkimDomain;
  if (dkimSel) out.dkim.selector = dkimSel;

  // SPF
  const spfMatch = h.match(/\bspf=([a-zA-Z]+)/i);
  const spfRaw = spfMatch ? spfMatch[1].toLowerCase() : "none";
  const spfResult = narrow(spfRaw, SPF_RESULTS, "none");
  out.spf = { result: spfResult };
  const spfIp = h.match(/\bclient-ip=([0-9a-fA-F.:]+)/i)?.[1];
  if (spfIp) out.spf.ip = spfIp;
  // smtp.mailfrom or envelope-from domain for SPF
  const spfMailFrom = h.match(/\bsmtp\.mailfrom=([^\s;,]+)/i)?.[1];
  if (spfMailFrom) {
    const at = spfMailFrom.indexOf("@");
    out.spf.domain = at >= 0 ? spfMailFrom.slice(at + 1) : spfMailFrom;
  }

  // DMARC
  const dmarcMatch = h.match(/\bdmarc=([a-zA-Z]+)/i);
  const dmarcRaw = dmarcMatch ? dmarcMatch[1].toLowerCase() : "none";
  const dmarcResult = narrow(dmarcRaw, DMARC_RESULTS, "none");
  out.dmarc = { result: dmarcResult };
  // Try policy.p= first, then disposition=, then p=
  const pol =
    h.match(/\bpolicy\.p=(none|quarantine|reject)\b/i)?.[1] ??
    h.match(/\bdisposition=(none|quarantine|reject)\b/i)?.[1] ??
    h.match(/\bp=(none|quarantine|reject)\b/i)?.[1];
  if (pol) out.dmarc.policy = pol.toLowerCase();

  return out;
}

/**
 * Detect TLS in transit from Received headers.
 * Returns true if any Received header contains "with ESMTPS",
 * false if headers present but no ESMTPS, null if no headers.
 */
export function extractTlsFromReceived(receivedHeaders: string[]): boolean | null {
  if (!receivedHeaders.length) return null;
  return receivedHeaders.some((h) => /\bwith ESMTPS\b/i.test(h));
}

/**
 * Extract domain from Return-Path header.
 * Handles "<addr@domain>" and bare "addr@domain" formats.
 */
export function extractReturnPathDomain(returnPath: string | null | undefined): string | null {
  if (!returnPath) return null;
  const s = returnPath.trim();
  // strip angle brackets if present
  const addr = s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr.slice(at + 1).toLowerCase().replace(/\.+$/, "");
  return domain || null;
}

/**
 * Compare apex domains (last 2 labels) for alignment.
 * Returns null if either input is falsy.
 */
export function computeApexAlignment(
  d1: string | null | undefined,
  d2: string | null | undefined
): "aligned" | "not_aligned" | null {
  if (!d1 || !d2) return null;

  const apex = (domain: string) => {
    const parts = domain.toLowerCase().replace(/\.+$/, "").split(".");
    return parts.slice(-2).join(".");
  };

  return apex(d1) === apex(d2) ? "aligned" : "not_aligned";
}

export function extractScanIdFromRecipient(recipient: string, inboundDomain: string): string | null {
  const r = recipient.trim().toLowerCase();
  const dom = inboundDomain.trim().toLowerCase();

  const at = r.lastIndexOf("@");
  if (at < 0) return null;

  const local = r.slice(0, at);
  const domain = r.slice(at + 1);

  if (domain !== dom) return null;
  if (!local.startsWith("verify+")) return null;

  const scanId = local.slice("verify+".length);
  return scanId || null;
}
