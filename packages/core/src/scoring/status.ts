export type ReadinessStatus = "strong" | "good" | "needs_improvement" | "high_risk";

export function statusFromScore(score: number): ReadinessStatus {
  if (score >= 90) return "strong";
  if (score >= 75) return "good";
  if (score >= 60) return "needs_improvement";
  return "high_risk";
}

export function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

