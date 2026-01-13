import { clampScore, statusFromScore, type ReadinessStatus } from "./status.js";

export interface WebsiteVitalsP95 {
  ttfb_ms?: number;
  lcp_ms?: number;
  cls?: number;
  inp_ms?: number;
}

export type Stability = "stable" | "variable" | "unstable" | "unknown";

export interface WebsiteScanInput {
  aggregates?: {
    mobile?: { p95?: WebsiteVitalsP95 };
    desktop?: { p95?: WebsiteVitalsP95 };
    stability?: Stability;
    cache?: { consistent_hit?: boolean | null };
    redirects?: { count?: number };
    blockers?: {
      render_blocking_js?: boolean;
      consent_blocks_interaction?: boolean;
      excessive_third_parties?: boolean;
    };
  };
  send_window?: { enabled?: boolean };
}

export interface WebsiteScoreSignals {
  stability: Stability;
  send_window_enabled: boolean;
  mobile_lcp_p95_ms: number | null;
  mobile_ttfb_p95_ms: number | null;
}

export interface WebsiteScoreResult {
  score: number;
  status: ReadinessStatus;
  bonus_applied: number;
  penalties: {
    ttfb: number;
    cwv: number;
    stability: number;
    blocking: number;
    desktop: number;
  };
  signals: WebsiteScoreSignals;
}

function penaltyTTFB(ttfb: number | null): number {
  if (ttfb == null) return 0;
  if (ttfb <= 600) return 0;
  if (ttfb <= 900) return 5;
  if (ttfb <= 1200) return 10;
  if (ttfb <= 1800) return 20;
  return 30;
}

function penaltyLCP(lcpMs: number | null): number {
  if (lcpMs == null) return 0;
  const lcp = lcpMs / 1000;
  if (lcp <= 2.5) return 0;
  if (lcp <= 3.0) return 5;
  if (lcp <= 4.0) return 15;
  return 25;
}

function penaltyCLS(cls: number | null): number {
  if (cls == null) return 0;
  if (cls <= 0.1) return 0;
  if (cls <= 0.25) return 5;
  return 10;
}

function penaltyINP(inp: number | null): number {
  if (inp == null) return 0;
  if (inp <= 200) return 0;
  if (inp <= 500) return 5;
  return 10;
}

export function scoreWebsiteReadiness(input: WebsiteScanInput): WebsiteScoreResult {
  const aggr = input.aggregates ?? {};
  const mobile = aggr.mobile?.p95 ?? {};
  const desktop = aggr.desktop?.p95 ?? {};

  const sendWindowEnabled = input.send_window?.enabled === true;

  const mobileTTFB = typeof mobile.ttfb_ms === "number" ? mobile.ttfb_ms : null;
  const mobileLCP = typeof mobile.lcp_ms === "number" ? mobile.lcp_ms : null;
  const mobileCLS = typeof mobile.cls === "number" ? mobile.cls : null;
  const mobileINP = typeof mobile.inp_ms === "number" ? mobile.inp_ms : null;

  // A) TTFB (max -30) + cache/redirect modifiers
  let ttfbPenalty = penaltyTTFB(mobileTTFB);

  const consistentHit = aggr.cache?.consistent_hit;
  if (consistentHit === false) ttfbPenalty += 5; // inconsistent cache
  const redirects = aggr.redirects?.count ?? 0;
  if (redirects > 1) ttfbPenalty += 3;

  if (ttfbPenalty > 30) ttfbPenalty = 30;

  // B) Core Web Vitals (max -40)
  let cwvPenalty = 0;
  cwvPenalty += penaltyLCP(mobileLCP); // up to 25
  cwvPenalty += penaltyCLS(mobileCLS); // up to 10
  cwvPenalty += penaltyINP(mobileINP); // up to 10
  if (cwvPenalty > 40) cwvPenalty = 40;

  // C) Stability around send window (max -20)
  let stabilityPenalty = 0;
  const stability: Stability = aggr.stability ?? "unknown";
  if (sendWindowEnabled) {
    if (stability === "unstable") stabilityPenalty = 20;
    else if (stability === "variable") stabilityPenalty = 10;
  }

  // D) Blocking & overhead (max -10)
  let blockingPenalty = 0;
  const blockers = aggr.blockers ?? {};
  if (blockers.render_blocking_js) blockingPenalty += 5;
  if (blockers.consent_blocks_interaction) blockingPenalty += 3;
  if (blockers.excessive_third_parties) blockingPenalty += 2;
  if (blockingPenalty > 10) blockingPenalty = 10;

  // E) Bonus (max +5)
  let bonus = 0;
  if (consistentHit === true) bonus += 2;
  // CDN/HTTP2/3 would come from scanner later; keep MVP minimal
  if (bonus > 5) bonus = 5;

  // F) Desktop penalty (supporting role, max -10)
  let desktopPenalty = 0;
  const desktopLcp = typeof desktop.lcp_ms === "number" ? desktop.lcp_ms : null;
  const desktopTtfb = typeof desktop.ttfb_ms === "number" ? desktop.ttfb_ms : null;

  // Only penalize if desktop is materially worse than mobile
  if (desktopLcp != null && mobileLCP != null && desktopLcp > mobileLCP * 1.25) desktopPenalty += 5;
  if (desktopTtfb != null && mobileTTFB != null && desktopTtfb > mobileTTFB * 1.3) desktopPenalty += 5;
  if (desktopPenalty > 10) desktopPenalty = 10;

  const rawScore = 100 - (ttfbPenalty + cwvPenalty + stabilityPenalty + blockingPenalty + desktopPenalty) + bonus;
  const score = clampScore(rawScore);
  const status = statusFromScore(score);

  return {
    score,
    status,
    bonus_applied: bonus,
    penalties: {
      ttfb: ttfbPenalty,
      cwv: cwvPenalty,
      stability: stabilityPenalty,
      blocking: blockingPenalty,
      desktop: desktopPenalty
    },
    signals: {
      stability,
      send_window_enabled: sendWindowEnabled,
      mobile_lcp_p95_ms: mobileLCP,
      mobile_ttfb_p95_ms: mobileTTFB
    }
  };
}

