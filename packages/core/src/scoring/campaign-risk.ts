// packages/core/src/scoring/campaign-risk.ts
import type { RiskLevel } from "../types/scan.js";

export interface CampaignRiskInput {
  email: {
    score: number; // 0..100, higher = better
    verified?: boolean; // Basic vs Verified
    signals: {
      dmarc_enforced: boolean;
      auth_critical: boolean;
      blacklisted: boolean;
    };
    dmarc_policy?: "none" | "quarantine" | "reject" | "unknown";
    dmarc_present?: boolean;
  };
  web: {
    score: number; // 0..100, higher = better
    signals: {
      stability: "stable" | "variable" | "unstable" | "unknown";
      send_window_enabled: boolean;
      mobile_lcp_p95_ms: number | null;
      mobile_ttfb_p95_ms: number | null;
    };
  };
}

export interface CampaignRiskResult {
  score: number; // 0..100 (higher = safer / lower risk)
  level: RiskLevel; // low|medium|high
  hard_stop_applied: boolean;
  hard_stop_reasons: string[];
}

function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

// 100 = low risk, 0 = high risk
function levelFromSafetyScore(score: number): RiskLevel {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  return "high";
}

export function scoreCampaignRisk(input: CampaignRiskInput): CampaignRiskResult {
  const reasons: string[] = [];

  const verified = input.email.verified === true;
  const sendWindowEnabled = input.web.signals.send_window_enabled === true;

  // -----------------------
  // Hard stop rules
  // -----------------------
  const dmarcPresent = input.email.dmarc_present; // only trust when explicitly set
  const dmarcPolicy = input.email.dmarc_policy; // only trust when explicitly set

  // DMARC missing/none are hard-stops regardless of Basic/Verified *when known*
  const hardStopDmarcMissing = dmarcPresent === false;
  const hardStopDmarcNone = dmarcPolicy === "none";

  if (hardStopDmarcMissing) reasons.push("dmarc_missing");
  if (hardStopDmarcNone) reasons.push("dmarc_policy_none");

  // Blacklist is always a hard stop if explicitly true
  if (input.email.signals.blacklisted === true) reasons.push("blacklisted");

  // Website hard stops only during send window
  if (sendWindowEnabled && input.web.signals.stability === "unstable") {
    reasons.push("website_unstable_during_send_window");
  }

  if (
    sendWindowEnabled &&
    input.web.signals.mobile_lcp_p95_ms != null &&
    input.web.signals.mobile_lcp_p95_ms > 4000
  ) {
    reasons.push("mobile_lcp_gt_4s_during_send_window");
  }

  // Very low website score as a hard-stop only when send window is enabled
  if (sendWindowEnabled && input.web.score < 50) reasons.push("website_score_lt_50");

  const hardStopApplied = reasons.length > 0;

  // -----------------------
  // Safety score (100 = best)
  // -----------------------
  let safetyScore = 100;

  // Email impact (treat Basic slightly softer because less measured)
  const e = input.email.score;
  if (e < 60) safetyScore -= verified ? 30 : 20;
  else if (e < 75) safetyScore -= 20;
  else if (e < 90) safetyScore -= 10;

  // auth_critical: stronger penalty in Verified (more evidence)
  if (input.email.signals.auth_critical) safetyScore -= verified ? 20 : 10;

  // Website impact
  const w = input.web.score;
  if (w < 60) safetyScore -= 25;
  else if (w < 75) safetyScore -= 15;
  else if (w < 90) safetyScore -= 5;

  const lcp = input.web.signals.mobile_lcp_p95_ms;
  if (lcp != null && lcp > 3000) safetyScore -= 10;

  const ttfb = input.web.signals.mobile_ttfb_p95_ms;
  if (ttfb != null && ttfb > 1200) safetyScore -= 10;

  // Stability modifier: only meaningful during send window
  if (sendWindowEnabled) {
    if (input.web.signals.stability === "variable") safetyScore -= 10;
    if (input.web.signals.stability === "unstable") safetyScore -= 20;
  }

  safetyScore = clamp01to100(safetyScore);

  // Hard stop forces high + caps below medium threshold
  const level: RiskLevel = hardStopApplied ? "high" : levelFromSafetyScore(safetyScore);
  const finalScore = hardStopApplied ? Math.min(safetyScore, 59) : safetyScore;

  return {
    score: finalScore,
    level,
    hard_stop_applied: hardStopApplied,
    hard_stop_reasons: reasons,
  };
}
