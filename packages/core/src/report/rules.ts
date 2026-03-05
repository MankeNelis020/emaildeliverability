// packages/core/src/report/rules.ts


import type { ScanResult } from "../types/scan.js";
import { ACTIONS, type ActionCopy, type ActionId } from "./copy.en.js";
import { scoreEmailReadiness } from "../scoring/email.js";
import { scoreWebsiteReadiness } from "../scoring/website.js";
import { scoreCampaignRisk } from "../scoring/campaign-risk.js";


export type Verdict = "low" | "medium" | "high";
export type Confidence = "high" | "medium" | "low";


export interface PriorityAction extends ActionCopy {
  priority: number; // higher = more important
}


export type BlockerId =
  | "blacklisted"
  | "dmarc_missing"
  | "dmarc_policy_none"
  | "auth_critical"
  | "website_unstable"
  | "mobile_lcp_gt_4s"
  | "website_score_lt_50";


export interface Blocker {
  id: BlockerId;
  message: string;
  severity: "hard" | "soft";
}


function hasNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}


type DmarcPolicy = "unknown" | "none" | "quarantine" | "reject";


function parseDmarcPolicyFromRecord(record: unknown): DmarcPolicy {
  if (!record) return "unknown";
  const s = String(record).toLowerCase();
  const m = s.match(/\bp\s*=\s*(none|quarantine|reject)\b/);
  if (!m) return "unknown";
  return m[1] as DmarcPolicy;
}


function normalizeDmarcPolicy(v: unknown): DmarcPolicy | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "unknown" || s === "none" || s === "quarantine" || s === "reject") return s;


  // sometimes we see "p=quarantine" or "policy=reject"
  if (s.includes("quarantine")) return "quarantine";
  if (s.includes("reject")) return "reject";
  if (s.includes("none")) return "none";
  return "unknown";
}


function isVerifiedScan(scan: any): boolean {
  const plan = String(scan?.inputs?.plan ?? scan?.inputs?.sku ?? scan?.inputs?.product ?? "").toLowerCase();
  if (plan.includes("verified")) return true;


  // heuristics (fallback)
  if (scan?.email_scan?.checks?.dkim) return true;
  if (scan?.inbound_email || scan?.email_evidence) return true;


  return false;
}


/**
 * Canonical auth signals for report rules.
 * - Basic: SPF + DMARC from scan.email_auth (DNS)
 * - Verified: DKIM/blacklists/SPF-result from scan.email_scan.checks (headers / deeper checks)
 */
function getAuthSignals(scan: any): {
  verified: boolean;


  dmarcPresent: boolean;
  dmarcPolicy: DmarcPolicy; // parsed from DNS record if needed


  spfPresent: boolean;
  spfResult: "unknown" | "pass" | "fail" | "softfail" | "neutral" | "permerror" | "temperror";


  dkimMeasured: boolean;
  dkimPresent: boolean;
  dkimResult: "unknown" | "pass" | "fail";


  listed: boolean;
} {
  const verified = isVerifiedScan(scan);


  const emailAuth = scan?.email_auth; // DNS-based
  const checks = scan?.email_scan?.checks ?? {}; // verified pipeline (may be absent in basic)


  // SPF presence: prefer verified checks, else email_auth
  const spfPresent =
    checks?.spf?.present === true ||
    emailAuth?.spf?.present === true;


  // SPF result: only meaningful if we have verified checks
  const spfResultRaw = typeof checks?.spf?.result === "string" ? String(checks.spf.result).toLowerCase() : "unknown";
  const spfResult =
    spfResultRaw === "pass" ||
    spfResultRaw === "fail" ||
    spfResultRaw === "softfail" ||
    spfResultRaw === "neutral" ||
    spfResultRaw === "permerror" ||
    spfResultRaw === "temperror"
      ? (spfResultRaw as any)
      : "unknown";


  // DMARC presence: prefer verified checks, else email_auth
  const dmarcPresent =
    checks?.dmarc?.present === true ||
    emailAuth?.dmarc?.present === true;


  // DMARC policy: prefer checks.dmarc.policy, else parse from email_auth.dmarc.record
  const dmarcPolicyFromChecks = normalizeDmarcPolicy(checks?.dmarc?.policy);
  const dmarcPolicy = dmarcPolicyFromChecks ?? parseDmarcPolicyFromRecord(emailAuth?.dmarc?.record);


  // DKIM is verified-only (basic doesn't measure it)
  const dkimMeasured = verified && Boolean(checks?.dkim);
  const dkimPresent = dkimMeasured ? checks?.dkim?.present === true : false;


  const dkimResultRaw = typeof checks?.dkim?.result === "string" ? String(checks.dkim.result).toLowerCase() : "unknown";
  const dkimResult = dkimResultRaw === "pass" || dkimResultRaw === "fail" ? (dkimResultRaw as any) : "unknown";


  // Blacklists: verified-only typically
  const listed = verified && checks?.blacklists?.listed === true;


  return {
    verified,
    dmarcPresent,
    dmarcPolicy,
    spfPresent,
    spfResult,
    dkimMeasured,
    dkimPresent,
    dkimResult,
    listed,
  };
}


export function deriveConfidence(scan: ScanResult): Confidence {
  const auth = getAuthSignals(scan);


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95;
  const vitalsSignals = mobile && (hasNumber(mobile.lcp_ms) || hasNumber(mobile.ttfb_ms));


  const authSignals = auth.dmarcPresent === true || auth.spfPresent === true;


  if (authSignals && vitalsSignals) return "high";
  if (authSignals || vitalsSignals) return "medium";
  return "low";
}


export function buildWhyList(
  scan: ScanResult,
  emailScore: number,
  webScore: number,
  verdict: Verdict
): string[] {
  const why: string[] = [];


  const auth = getAuthSignals(scan);
  const verified = auth.verified;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  // DMARC (Basic truth)
  if (!auth.dmarcPresent) why.push("DMARC is missing (no policy enforcement possible).");
  else if (auth.dmarcPolicy === "none") why.push("DMARC policy is not enforced (policy=none).");


  // DKIM (Verified-only)
  if (verified) {
    if (!auth.dkimPresent) why.push("DKIM signing is missing (based on verified scan evidence).");
  } else {
    why.push("DKIM was not evaluated in Basic (run a Verified scan to validate email headers).");
  }


  // SPF (Basic truth)
  if (!auth.spfPresent) why.push("SPF record is missing.");
  else if (verified) {
    // only interpret result if verified
    if (auth.spfResult === "softfail" || auth.spfResult === "neutral") why.push("SPF is weak (softfail/neutral).");
    else if (auth.spfResult === "fail" || auth.spfResult === "permerror") why.push("SPF is failing (fail/permerror).");
  }


  if (auth.listed) why.push("Blacklist signal detected (needs immediate investigation).");


  if (sendWindowEnabled && stability === "unstable") why.push("Website is unstable during the planned send window.");
  if (sendWindowEnabled && lcpMs != null && lcpMs > 4000) why.push("Mobile LCP exceeds 4 seconds during send window.");
  if (ttfbMs != null && ttfbMs > 1200) why.push("High server response time (TTFB).");


  const trimmed = why.slice(0, 5);


  if (trimmed.length === 0) {
    if (verdict === "low") return ["No critical blockers detected. Keep monitoring and iterate on small wins."];
    return [
      `Email readiness: ${emailScore}/100, Website readiness: ${webScore}/100.`,
      "Address the top issues below before your next send.",
    ];
  }


  return trimmed;
}


function addAction(actions: Map<ActionId, PriorityAction>, id: ActionId, priority: number) {
  const existing = actions.get(id);
  if (!existing || priority > existing.priority) {
    actions.set(id, { ...ACTIONS[id], priority });
  }
}


export function selectTopActions(scan: ScanResult, emailScore: number, webScore: number): PriorityAction[] {
  const actions = new Map<ActionId, PriorityAction>();


  const auth = getAuthSignals(scan);
  const verified = auth.verified;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  const blockers = (scan.website_scan as any)?.aggregates?.blockers ?? {};
  const cacheHit = (scan.website_scan as any)?.aggregates?.cache?.consistent_hit;


  // Email actions (Basic truth)
  if (!auth.dmarcPresent) addAction(actions, "dmarc_add", 100);
  else if (auth.dmarcPolicy === "none") addAction(actions, "dmarc_enforce", 95);


  if (!auth.spfPresent) addAction(actions, "spf_add", 70);
  else if (verified && (auth.spfResult === "fail" || auth.spfResult === "permerror")) addAction(actions, "spf_fix", 70);
  else if (verified && (auth.spfResult === "softfail" || auth.spfResult === "neutral")) addAction(actions, "spf_fix", 55);


  // DKIM actions (Verified-only)
  if (verified) {
    if (!auth.dkimPresent) addAction(actions, "dkim_add", 90);
    else if (auth.dkimResult === "fail") addAction(actions, "dkim_fix", 90);
  }


  if (auth.listed) addAction(actions, "blacklist_cleanup", 110);


  // Website actions
  if (sendWindowEnabled && stability === "unstable") addAction(actions, "stabilize_send_window", 100);


  if (lcpMs != null && lcpMs > 4000) addAction(actions, "reduce_lcp", 85);
  else if (lcpMs != null && lcpMs > 3000) addAction(actions, "reduce_lcp", 70);


  if (ttfbMs != null && ttfbMs > 1800) addAction(actions, "reduce_ttfb", 85);
  else if (ttfbMs != null && ttfbMs > 1200) addAction(actions, "reduce_ttfb", 70);


  if (blockers.render_blocking_js || blockers.consent_blocks_interaction || blockers.excessive_third_parties) {
    addAction(actions, "reduce_render_blocking", 60);
  }
  if (cacheHit === false) addAction(actions, "cache_consistency", 55);


  // Boost if extremely low
  if (webScore < 40) {
    addAction(actions, "reduce_ttfb", 90);
    addAction(actions, "reduce_lcp", 90);
  }


  if (emailScore < 60) {
    if (!auth.dmarcPresent) addAction(actions, "dmarc_add", 100);
    if (auth.dmarcPolicy === "none") addAction(actions, "dmarc_enforce", 98);


    if (verified && !auth.dkimPresent) addAction(actions, "dkim_add", 95);
    if (!auth.spfPresent) addAction(actions, "spf_add", 80);
  }


  return Array.from(actions.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}


export function computeScoresFromScan(scan: ScanResult) {
  // ✅ Pass the WHOLE scan so Basic can synthesize from scan.email_auth,
  // and Verified can still use scan.email_scan.checks.
  const email = scoreEmailReadiness(scan as any);

  const web = scoreWebsiteReadiness({
    ...(scan.website_scan as any),
    send_window: { enabled: scan.inputs?.send_window?.enabled === true }
  });

  const auth = getAuthSignals(scan);

  const dmarc_present = typeof auth.dmarcPresent === "boolean" ? auth.dmarcPresent : undefined;
  const dmarc_policy = normalizeDmarcPolicy(auth.dmarcPolicy);

  const risk = scoreCampaignRisk({
    email: {
      score: email.score,
      signals: email.signals,
      dmarc_present,
      dmarc_policy,
      // ✅ if you added verified support in campaign-risk:
      verified: isVerifiedScan(scan as any),
    },
    web: { score: web.score, signals: web.signals }
  });

  const verdict: Verdict = risk.level;
  return { email, web, risk, verdict };
}



export function deriveBlockers(scan: ScanResult, emailScore: number, webScore: number): Blocker[] {
  const blockers: Blocker[] = [];


  const auth = getAuthSignals(scan);
  const verified = auth.verified;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  // DKIM: Verified-only
  if (verified && !auth.dkimPresent) {
    blockers.push({
      id: "auth_critical",
      severity: "hard",
      message: "DKIM signing not detected (verified scan checks email headers).",
    });
  }


  // SPF: Basic truth
  if (!auth.spfPresent) {
    blockers.push({ id: "auth_critical", severity: "hard", message: "SPF record is missing." });
  } else if (verified && (auth.spfResult === "softfail" || auth.spfResult === "neutral")) {
    blockers.push({ id: "auth_critical", severity: "soft", message: "SPF is weak (softfail/neutral)." });
  }


  if (auth.listed) blockers.push({ id: "blacklisted", severity: "hard", message: "Blacklist signal detected." });


  // DMARC: Basic truth
  if (!auth.dmarcPresent) {
    blockers.push({ id: "dmarc_missing", severity: "hard", message: "DMARC is missing." });
  }
  if (auth.dmarcPresent && auth.dmarcPolicy === "none") {
    blockers.push({
      id: "dmarc_policy_none",
      severity: "soft",
      message: "DMARC policy is not enforced (policy=none).",
    });
  }


  if (sendWindowEnabled && stability === "unstable") {
    blockers.push({ id: "website_unstable", severity: "hard", message: "Website is unstable during the planned send window." });
  }


  if (sendWindowEnabled && lcpMs != null && lcpMs > 4000) {
    blockers.push({ id: "mobile_lcp_gt_4s", severity: "soft", message: "Mobile LCP exceeds 4 seconds during send window." });
  }


  if (webScore < 50) blockers.push({ id: "website_score_lt_50", severity: "soft", message: "Website readiness score is below 50." });


  return blockers.slice(0, 8);
}


export function isReadyToSend(verdict: Verdict, blockers: Blocker[]): boolean {
  if (verdict === "high") return false;
  if (blockers.some((b) => b.severity === "hard")) return false;
  return true;
}


export function headlineFor(verdict: Verdict, emailScore: number, webScore: number): string {
  if (verdict === "high") return "High risk: fix authentication and stability before sending.";
  if (verdict === "medium") return "Moderate risk: address key issues to improve deliverability and performance.";
  // low
  if (emailScore >= 80 && webScore >= 80) return "Looks good: you’re close to send-ready.";
  return "Low risk: a few improvements will make this even stronger.";
}
