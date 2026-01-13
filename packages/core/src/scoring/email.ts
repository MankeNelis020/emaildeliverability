import { clampScore, statusFromScore, type ReadinessStatus } from "./status.js";

export type SpfResult =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "permerror"
  | "temperror"
  | "unknown";

export type DmarcPolicy = "none" | "quarantine" | "reject" | "unknown";

export interface EmailScanInput {
  checks?: {
    spf?: {
      present?: boolean;
      result?: SpfResult;
      alignment?: "aligned" | "not_aligned" | "unknown";
      dns_lookup_count?: number;
    };
    dkim?: {
      present?: boolean;
      result?: "pass" | "fail" | "unknown";
      alignment?: "aligned" | "not_aligned" | "unknown";
      selectors_checked?: string[];
    };
    dmarc?: {
      present?: boolean;
      policy?: DmarcPolicy;
      pct?: number;
      alignment_mode?: "relaxed" | "strict" | "unknown";
    };
    mx?: {
      tls?: { supported?: boolean };
    };
    mta_sts?: {
      present?: boolean;
      policy_mode?: "enforce" | "testing" | "none" | "unknown";
    };
    tlsrpt?: { present?: boolean };
    bimi?: { present?: boolean };
    blacklists?: { listed?: boolean; hits?: Array<{ list: string; evidence?: string }> };
  };
}

export interface EmailScoreSignals {
  dmarc_enforced: boolean;
  auth_critical: boolean;
  blacklisted: boolean;
}

export interface EmailScoreResult {
  score: number;
  status: ReadinessStatus;
  bonus_applied: number;
  penalties: {
    spf: number;
    dkim: number;
    dmarc: number;
    transport: number;
    reputation: number;
  };
  signals: EmailScoreSignals;
}

/**
 * Deterministic email readiness scoring v1.
 * - Start at 100
 * - Apply penalties per agreed rules
 * - Apply bonus (max +5)
 * - Clamp 0..100
 */
export function scoreEmailReadiness(input: EmailScanInput): EmailScoreResult {
  const checks = input.checks ?? {};

  // --- DMARC penalties
  let dmarcPenalty = 0;
  const dmarc = checks.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;

  if (!dmarcPresent) {
    dmarcPenalty += 30;
  } else {
    const policy = dmarc.policy ?? "unknown";
    if (policy === "none") dmarcPenalty += 20;
    else if (policy === "quarantine") dmarcPenalty += 10;
    // reject => 0
    const pct = typeof dmarc.pct === "number" ? dmarc.pct : 100;
    if (pct < 100) dmarcPenalty += 5;
  }

  // --- DKIM penalties
  let dkimPenalty = 0;
  const dkim = checks.dkim ?? {};
  const dkimPresent = dkim.present === true;

  if (!dkimPresent) {
    dkimPenalty += 20;
  } else {
    const result = dkim.result ?? "unknown";
    if (result === "fail") dkimPenalty += 20;
    if ((dkim.alignment ?? "unknown") === "not_aligned") dkimPenalty += 10;
  }

  // --- SPF penalties
  let spfPenalty = 0;
  const spf = checks.spf ?? {};
  const spfPresent = spf.present === true;

  if (!spfPresent) {
    spfPenalty += 15;
  } else {
    const result = spf.result ?? "unknown";
    if (result === "fail" || result === "permerror") spfPenalty += 15;
    else if (result === "softfail" || result === "neutral") spfPenalty += 5;

    if ((spf.alignment ?? "unknown") === "not_aligned") spfPenalty += 5;

    const lookups = typeof spf.dns_lookup_count === "number" ? spf.dns_lookup_count : 0;
    if (lookups > 10) spfPenalty += 5;
  }

  // --- Transport penalties
  let transportPenalty = 0;
  const mxTlsSupported = checks.mx?.tls?.supported;
  if (mxTlsSupported === false) transportPenalty += 10;

  const mtaStsPresent = checks.mta_sts?.present === true;
  if (!mtaStsPresent) transportPenalty += 5;

  // --- Reputation penalties
  let reputationPenalty = 0;
  const listed = checks.blacklists?.listed === true;
  if (listed) reputationPenalty += 30;

  // --- Bonus (cap +5)
  let bonus = 0;
  if ((dmarc.alignment_mode ?? "unknown") === "strict") bonus += 3;

  const selectors = dkim.selectors_checked ?? [];
  if (selectors.length >= 2) bonus += 2;

  if (checks.mta_sts?.policy_mode === "enforce") bonus += 2;
  if (checks.tlsrpt?.present === true) bonus += 1;
  if (checks.bimi?.present === true) bonus += 2;

  if (bonus > 5) bonus = 5;

  // --- Total score
  const rawScore =
    100 -
    (dmarcPenalty + dkimPenalty + spfPenalty + transportPenalty + reputationPenalty) +
    bonus;

  const score = clampScore(rawScore);
  const status = statusFromScore(score);

  // Signals for campaign risk mapping
  const dmarcPolicy = dmarc.policy ?? "unknown";
  const dmarcEnforced = dmarcPresent && (dmarcPolicy === "quarantine" || dmarcPolicy === "reject");

  const authCritical =
    (!dmarcPresent || dmarcPolicy === "none") ||
    (dkimPresent && (dkim.result ?? "unknown") === "fail") ||
    (spfPresent && ((spf.result ?? "unknown") === "fail" || (spf.result ?? "unknown") === "permerror"));

  const blacklisted = listed;

  return {
    score,
    status,
    bonus_applied: bonus,
    penalties: {
      spf: spfPenalty,
      dkim: dkimPenalty,
      dmarc: dmarcPenalty,
      transport: transportPenalty,
      reputation: reputationPenalty
    },
    signals: {
      dmarc_enforced: dmarcEnforced,
      auth_critical: authCritical,
      blacklisted
    }
  };
}

