// packages/core/src/report/generateReportV1.ts


import type { ScanResult } from "../types/scan.js";
import {
  buildWhyList,
  computeScoresFromScan,
  deriveBlockers,
  deriveConfidence,
  headlineFor,
  isReadyToSend,
  selectTopActions,
  type Confidence,
  type Verdict,
  type Blocker
} from "./rules.js";


export interface ReportV1 {
  report_version: "1.0";
  generated_at: string;
  scan_id: string;


  headline: string;
  verdict: Verdict;
  confidence: Confidence;


  // ✅ these were missing in your type
  ready_to_send: boolean;
  blockers: Blocker[];


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
 * Deterministic report generator:
 * - recomputes scores from scan payload
 * - derives blockers + ready_to_send
 * - selects top actions
 */
export function generateReportV1(scan: ScanResult): ReportV1 {
  const { email, web, risk, verdict } = computeScoresFromScan(scan);
  const confidence = deriveConfidence(scan);


  const blockers = deriveBlockers(scan, email.score, web.score);
  const ready_to_send = isReadyToSend(verdict, blockers);


  const why = buildWhyList(scan, email.score, web.score, verdict);
  const actions = selectTopActions(scan, email.score, web.score);


  return {
    report_version: "1.0",
    generated_at: new Date().toISOString(),
    scan_id: scan.scan_id,


    headline: headlineFor(verdict, email.score, web.score),
    verdict,
    confidence,


    // ✅ now included
    ready_to_send,
    blockers,


    scores: {
      email: { score: email.score, status: email.status },
      website: { score: web.score, status: web.status },
      campaign: { score: risk.score, level: risk.level }
    },


    why,


    top_actions: actions.map((a: any) => ({
      id: String(a.id ?? "action"),
      title: a.title,
      why: a.why,
      impact: a.impact,
      effort: a.effort,
      steps: a.steps
    }))
  };
}
