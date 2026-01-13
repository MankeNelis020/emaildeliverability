import type { ScanResult } from "../types/scan.js";
import { headlineFor } from "./copy.en.js";
import { buildWhyList, computeScoresFromScan, deriveConfidence, selectTopActions, type Confidence, type Verdict } from "./rules.js";

export interface ReportV1 {
  report_version: "1.0";
  generated_at: string;
  scan_id: string;

  headline: string;
  verdict: Verdict;
  confidence: Confidence;

  scores: {
    email: { score: number; status: string };
    website: { score: number; status: string };
    campaign: { score: number; level: Verdict };
  };

  why: string[];

  top_actions: Array<{
    id: string;
    title: string;
    why: string;
    impact: string;
    effort: string;
    steps: string[];
  }>;
}

/**
 * Generates a B2B-first report (no white-label, opinionated copy).
 * Deterministic: recomputes scores from scan inputs and raw scan payload.
 */
export function generateReportV1(scan: ScanResult): ReportV1 {
  const { email, web, risk, verdict } = computeScoresFromScan(scan);
  const confidence = deriveConfidence(scan);

  const why = buildWhyList(scan, email.score, web.score, verdict);

  const actions = selectTopActions(scan, email.score, web.score);

  return {
    report_version: "1.0",
    generated_at: new Date().toISOString(),
    scan_id: scan.scan_id,

    headline: headlineFor(verdict, email.score, web.score),
    verdict,
    confidence,

    scores: {
      email: { score: email.score, status: email.status },
      website: { score: web.score, status: web.status },
      campaign: { score: risk.score, level: risk.level }
    },

    why,

    top_actions: actions.map(a => ({
      id: a.id,
      title: a.title,
      why: a.why,
      impact: a.impact,
      effort: a.effort,
      steps: a.steps
    }))
  };
}

