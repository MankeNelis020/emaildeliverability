import type { RiskLevel } from "../types/scan.js";

export interface CampaignRiskInput {
  email: {
    score: number;
    signals: {
      dmarc_enforced: boolean;
      auth_critical: boolean;
      blacklisted: boolean;
    };
    // Optional raw policy hint if you pass it later
    dmarc_policy?: "none" | "quarantine" | "reject" | "unknown";
    dmarc_present?: boolean;
  };
  web: {
    score: number;
    signals: {
      stability: "stable" | "variable" | "unstable" | "unknown";
      send_window_enabled: boolean;
      mobile_lcp_p95_ms: number | null;
      mobile_ttfb_p95_ms: number | null;
    };
  };
}

export interface CampaignRiskResult {
  score: number; // 0..100
  level: RiskLevel; // low|medium|high
  hard_stop_applied: boolean;
  hard_stop_reasons: string[];
}

function clamp01to100(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function levelFromRiskScore(score: number): RiskLevel {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  return "high";
}

export function scoreCampaignRisk(input: CampaignRiskInput): CampaignRiskResult {
  const reasons: string[] = [];

  // --- Hard stop rules (Taak 3C)
  const dmarcPresent = input.email.dmarc_present;
  const dmarcPolicy = input.email.dmarc_policy;

  // If you pass explicit DMARC presence/policy from scanner later, use it.
  // For MVP, we infer "not enforced" as risk, but hard-stops should rely on explicit flags when available.
  const hardStopDmarcMissing = dmarcPresent === false;
  const hardStopDmarcNone = dmarcPolicy === "none";

  if (hardStopDmarcMissing) reasons.push("dmarc_missing");
  if (hardStopDmarcNone) reasons.push("dmarc_policy_none");
  if (input.email.signals.blacklisted) reasons.push("blacklisted");
  if (input.web.signals.stability === "unstable") reasons.push("website_unstable");
  if (
    input.web.signals.send_window_enabled &&
    input.web.signals.mobile_lcp_p95_ms != null &&
    input.web.signals.mobile_lcp_p95_ms > 4000
  ) {
    reasons.push("mobile_lcp_gt_4s_during_send_window");
  }
  if (input.web.score < 50) reasons.push("website_score_lt_50");

  const hardStopApplied = reasons.length > 0;
  if (hardStopApplied) {
    // For hard-stop cases we still compute a score, but always classify as HIGH.
    // Keep score as minimum of computed and 59 to match mapping, while preserving comparability.
  }

  // --- Risk score (0..100), starts at 100 and subtracts
  let riskScore = 100;

  // Email impact (max -50)
  const e = input.email.score;
  if (e < 60) riskScore -= 30;
  else if (e < 75) riskScore -= 20;
  else if (e < 90) riskScore -= 10;

  if (input.email.signals.auth_critical) riskScore -= 20;

  // Website impact (max -40)
  const w = input.web.score;
  if (w < 60) riskScore -= 25;
  else if (w < 75) riskScore -= 15;
  else if (w < 90) riskScore -= 5;

  const lcp = input.web.signals.mobile_lcp_p95_ms;
  if (lcp != null && lcp > 3000) riskScore -= 10;

  const ttfb = input.web.signals.mobile_ttfb_p95_ms;
  if (ttfb != null && ttfb > 1200) riskScore -= 10;

  // Stability modifier
  if (input.web.signals.stability === "variable") riskScore -= 10;
  if (input.web.signals.stability === "unstable") riskScore -= 20;

  riskScore = clamp01to100(riskScore);

  // If hard-stop applied, force level high and cap score below 60
  const level: RiskLevel = hardStopApplied ? "high" : levelFromRiskScore(riskScore);
  const finalScore = hardStopApplied ? Math.min(riskScore, 59) : riskScore;

  return {
    score: finalScore,
    level,
    hard_stop_applied: hardStopApplied,
    hard_stop_reasons: reasons
  };
}

