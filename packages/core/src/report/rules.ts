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

function hasNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function deriveConfidence(scan: ScanResult): Confidence {
  // Simple heuristic: if we have key vitals + auth objects, confidence is higher.
  const dmarc = (scan.email_scan as any)?.checks?.dmarc;
  const spf = (scan.email_scan as any)?.checks?.spf;
  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95;

  const authSignals = !!dmarc || !!spf;
  const vitalsSignals = mobile && (hasNumber(mobile.lcp_ms) || hasNumber(mobile.ttfb_ms));

  if (authSignals && vitalsSignals) return "high";
  if (authSignals || vitalsSignals) return "medium";
  return "low";
}

export function buildWhyList(scan: ScanResult, emailScore: number, webScore: number, verdict: Verdict): string[] {
  const why: string[] = [];

  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;
  const dmarcPolicy = (dmarc.policy ?? "unknown") as string;

  const dkim = (scan.email_scan as any)?.checks?.dkim ?? {};
  const dkimPresent = dkim.present === true;

  const spf = (scan.email_scan as any)?.checks?.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult = (spf.result ?? "unknown") as string;

  const listed = (scan.email_scan as any)?.checks?.blacklists?.listed === true;

  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;

  const stability = ((scan.website_scan as any)?.aggregates?.stability ?? "unknown") as string;
  const sendWindowEnabled = scan.inputs.send_window.enabled === true;

  if (!dmarcPresent) why.push("DMARC is missing (no policy enforcement possible).");
  else if (dmarcPolicy === "none") why.push("DMARC policy is not enforced (policy=none).");

  if (!dkimPresent) why.push("DKIM signing is missing.");
  if (!spfPresent) why.push("SPF record is missing.");
  else if (spfResult === "softfail" || spfResult === "neutral") why.push("SPF is weak (softfail/neutral).");
  else if (spfResult === "fail" || spfResult === "permerror") why.push("SPF is failing (fail/permerror).");

  if (listed) why.push("Blacklist signal detected (needs immediate investigation).");

  if (sendWindowEnabled && stability === "unstable") why.push("Website is unstable during the planned send window.");
  if (sendWindowEnabled && lcpMs != null && lcpMs > 4000) why.push("Mobile LCP exceeds 4s during send window.");
  if (ttfbMs != null && ttfbMs > 1200) why.push("High server response time (TTFB).");

  // Ensure it’s not too long
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
  const dmarcPolicy = (dmarc.policy ?? "unknown") as string;

  const dkim = (scan.email_scan as any)?.checks?.dkim ?? {};
  const dkimPresent = dkim.present === true;
  const dkimResult = (dkim.result ?? "unknown") as string;

  const spf = (scan.email_scan as any)?.checks?.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult = (spf.result ?? "unknown") as string;
  const lookups = hasNumber(spf.dns_lookup_count) ? spf.dns_lookup_count : 0;

  const listed = (scan.email_scan as any)?.checks?.blacklists?.listed === true;

  const mobile = (scan.website_scan as any)?.aggregates?.mobile?.p95 ?? {};
  const lcpMs = hasNumber(mobile.lcp_ms) ? mobile.lcp_ms : null;
  const ttfbMs = hasNumber(mobile.ttfb_ms) ? mobile.ttfb_ms : null;

  const stability = ((scan.website_scan as any)?.aggregates?.stability ?? "unknown") as string;
  const sendWindowEnabled = scan.inputs.send_window.enabled === true;

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

  // If scores are extremely low, bump core website items
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
    send_window: { enabled: scan.inputs.send_window.enabled }
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

