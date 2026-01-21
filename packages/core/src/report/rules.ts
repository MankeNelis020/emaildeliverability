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


export function deriveConfidence(scan: ScanResult): Confidence {
  const dmarc = (scan.email_scan as any)?.checks?.dmarc;
  const spf = (scan.email_scan as any)?.checks?.spf;
  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95;


  const authSignals = !!dmarc || !!spf;
  const vitalsSignals = mobile && (hasNumber(mobile.lcp_ms) || hasNumber(mobile.ttfb_ms));


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


  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;
  const dmarcPolicy = String(dmarc.policy ?? "unknown");


  const dkim = (scan.email_scan as any)?.checks?.dkim ?? {};
  const dkimPresent = dkim.present === true;


  const spf = (scan.email_scan as any)?.checks?.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult = String(spf.result ?? "unknown").toLowerCase();


  const listed = (scan.email_scan as any)?.checks?.blacklists?.listed === true;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  if (!dmarcPresent) why.push("DMARC is missing (no policy enforcement possible).");
  else if (dmarcPolicy === "none") why.push("DMARC policy is not enforced (policy=none).");


  if (!dkimPresent) why.push("DKIM signing is missing.");
  if (!spfPresent) why.push("SPF record is missing.");
  else if (spfResult === "softfail" || spfResult === "neutral") why.push("SPF is weak (softfail/neutral).");
  else if (spfResult === "fail" || spfResult === "permerror") why.push("SPF is failing (fail/permerror).");


  if (listed) why.push("Blacklist signal detected (needs immediate investigation).");


  if (sendWindowEnabled && stability === "unstable") why.push("Website is unstable during the planned send window.");
  if (sendWindowEnabled && lcpMs != null && lcpMs > 4000) why.push("Mobile LCP exceeds 4 seconds during send window.");
  if (ttfbMs != null && ttfbMs > 1200) why.push("High server response time (TTFB).");


  const trimmed = why.slice(0, 5);


  if (trimmed.length === 0) {
    if (verdict === "low") return ["No critical blockers detected. Keep monitoring and iterate on small wins."];
    return [
      `Email readiness: ${emailScore}/100, Website readiness: ${webScore}/100.`,
      "Address the top issues below before your next send."
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


  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;
  const dmarcPolicy = String(dmarc.policy ?? "unknown");


  const dkim = (scan.email_scan as any)?.checks?.dkim ?? {};
  const dkimPresent = dkim.present === true;
  const dkimResult = String(dkim.result ?? "unknown").toLowerCase();


  const spf = (scan.email_scan as any)?.checks?.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult = String(spf.result ?? "unknown").toLowerCase();
  const lookups = hasNumber(spf.dns_lookup_count) ? spf.dns_lookup_count : 0;


  const listed = (scan.email_scan as any)?.checks?.blacklists?.listed === true;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  const blockers = (scan.website_scan as any)?.aggregates?.blockers ?? {};
  const cacheHit = (scan.website_scan as any)?.aggregates?.cache?.consistent_hit;


  // Email actions
  if (!dmarcPresent) addAction(actions, "dmarc_add", 100);
  else if (dmarcPolicy === "none") addAction(actions, "dmarc_enforce", 95);


  if (!dkimPresent) addAction(actions, "dkim_add", 90);
  else if (dkimResult === "fail") addAction(actions, "dkim_fix", 90);


  if (!spfPresent) addAction(actions, "spf_add", 70);
  else if (spfResult === "fail" || spfResult === "permerror") addAction(actions, "spf_fix", 70);
  else if (spfResult === "softfail" || spfResult === "neutral") addAction(actions, "spf_fix", 55);
  if (lookups > 10) addAction(actions, "spf_fix", 60);


  if (listed) addAction(actions, "blacklist_cleanup", 110);


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
    if (!dmarcPresent) addAction(actions, "dmarc_add", 100);
    if (dmarcPolicy === "none") addAction(actions, "dmarc_enforce", 98);
    if (!dkimPresent) addAction(actions, "dkim_add", 95);
  }


  return Array.from(actions.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}


export function computeScoresFromScan(scan: ScanResult) {
  const email = scoreEmailReadiness(scan.email_scan as any);


  const web = scoreWebsiteReadiness({
    ...(scan.website_scan as any),
    send_window: { enabled: scan.inputs?.send_window?.enabled === true }
  });


  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarc_present = typeof dmarc.present === "boolean" ? dmarc.present : undefined;
  const dmarc_policy = typeof dmarc.policy === "string" ? dmarc.policy : undefined;


  const risk = scoreCampaignRisk({
    email: { score: email.score, signals: email.signals, dmarc_present, dmarc_policy },
    web: { score: web.score, signals: web.signals }
  });


  const verdict: Verdict = risk.level;
  return { email, web, risk, verdict };
}


export function deriveBlockers(scan: ScanResult, emailScore: number, webScore: number): Blocker[] {
  const blockers: Blocker[] = [];


  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;
  const dmarcPolicy = String(dmarc.policy ?? "unknown");


  const dkim = (scan.email_scan as any)?.checks?.dkim ?? {};
  const dkimPresent = dkim.present === true;


  const spf = (scan.email_scan as any)?.checks?.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult = String(spf.result ?? "unknown").toLowerCase();


  const listed = (scan.email_scan as any)?.checks?.blacklists?.listed === true;


  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;


  const stability = String((scan.website_scan as any)?.aggregates?.stability ?? "unknown");
  const sendWindowEnabled = scan.inputs?.send_window?.enabled === true;


  if (!dkimPresent) blockers.push({ id: "auth_critical", severity: "hard", message: "DKIM record not detected via DNS." });


  if (!spfPresent) blockers.push({ id: "auth_critical", severity: "hard", message: "SPF record is missing." });
  else if (spfResult === "softfail" || spfResult === "neutral")
    blockers.push({ id: "auth_critical", severity: "soft", message: "SPF is weak (softfail/neutral)." });


  if (listed) blockers.push({ id: "blacklisted", severity: "hard", message: "Blacklist signal detected." });


  if (!dmarcPresent) blockers.push({ id: "dmarc_missing", severity: "hard", message: "DMARC is missing." });
  if (dmarcPresent && dmarcPolicy === "none")
    blockers.push({ id: "dmarc_policy_none", severity: "soft", message: "DMARC policy is not enforced (policy=none)." });


  if (sendWindowEnabled && stability === "unstable")
    blockers.push({ id: "website_unstable", severity: "hard", message: "Website is unstable during the planned send window." });


  if (sendWindowEnabled && lcpMs != null && lcpMs > 4000)
    blockers.push({ id: "mobile_lcp_gt_4s", severity: "soft", message: "Mobile LCP exceeds 4 seconds during send window." });


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


