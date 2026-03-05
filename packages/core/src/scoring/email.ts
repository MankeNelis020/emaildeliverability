// packages/core/src/scoring/email.ts
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

// -------------------------
// Helpers: Basic vs Verified
// -------------------------

type AnyObj = Record<string, any>;

function parseDmarcPolicyFromRecord(record: unknown): DmarcPolicy {
  if (!record) return "unknown";
  const s = String(record).toLowerCase();
  const m = s.match(/\bp\s*=\s*(none|quarantine|reject)\b/);
  if (!m) return "unknown";
  const p = m[1];
  if (p === "none" || p === "quarantine" || p === "reject") return p;
  return "unknown";
}

function isVerifiedLike(input: AnyObj): boolean {
  // Verified typically has these signals
  const plan = String(
    input?.inputs?.plan ??
      input?.inputs?.sku ??
      input?.inputs?.product ??
      input?.plan ??
      input?.sku ??
      ""
  ).toLowerCase();

  if (plan.includes("verified")) return true;

  if (input?.checks?.dkim) return true;
  if (input?.email_scan?.checks?.dkim) return true;
  if (input?.inbound_email || input?.email_evidence) return true;

  return false;
}

/**
 * Build canonical "checks":
 * - Prefer input.checks
 * - Else prefer input.email_scan.checks
 * - Else synthesize from input.email_auth (Basic DNS results)
 */
function getChecks(input: AnyObj): NonNullable<EmailScanInput["checks"]> {
  if (input?.checks) return input.checks;
  if (input?.email_scan?.checks) return input.email_scan.checks;

  // Basic scan: synthesize SPF + DMARC from email_auth
  const emailAuth = input?.email_auth;
  const spfPresent = emailAuth?.spf?.present === true;
  const dmarcPresent = emailAuth?.dmarc?.present === true;

  const dmarcPolicy = parseDmarcPolicyFromRecord(emailAuth?.dmarc?.record);

  return {
    spf: {
      present: spfPresent,
      result: "unknown",
      alignment: "unknown",
      dns_lookup_count: 0,
    },
    dmarc: {
      present: dmarcPresent,
      policy: dmarcPolicy,
      pct: 100,
      alignment_mode: "unknown",
    },
    // DKIM / transport / blacklists intentionally omitted in Basic (not measured)
  };
}

/**
 * Deterministic email readiness scoring v1 (robust for Basic + Verified).
 *
 * Rules:
 * - Start 100
 * - Penalize DMARC/SPF always when those are measured (Basic via email_auth synthesis)
 * - Penalize DKIM/transport/blacklists ONLY when measured (Verified-like checks present)
 */
export function scoreEmailReadiness(input: EmailScanInput | AnyObj): EmailScoreResult {
  const anyInput = input as AnyObj;
  const checks = getChecks(anyInput);
  const verified = isVerifiedLike(anyInput);

  // -----------------
  // DMARC penalties
  // -----------------
  let dmarcPenalty = 0;
  const dmarc = checks.dmarc ?? {};
  const dmarcPresent = dmarc.present === true;

  const dmarcPolicy: DmarcPolicy = (dmarc.policy ?? "unknown") as DmarcPolicy;

  if (!dmarcPresent) {
    dmarcPenalty += 30;
  } else {
    if (dmarcPolicy === "none") dmarcPenalty += 20;
    else if (dmarcPolicy === "quarantine") dmarcPenalty += 10;
    // reject => 0
    const pct = typeof dmarc.pct === "number" ? dmarc.pct : 100;
    if (pct < 100) dmarcPenalty += 5;
  }

  // -----------------
  // SPF penalties
  // -----------------
  let spfPenalty = 0;
  const spf = checks.spf ?? {};
  const spfPresent = spf.present === true;
  const spfResult: SpfResult = (spf.result ?? "unknown") as SpfResult;

  if (!spfPresent) {
    spfPenalty += 15;
  } else {
    if (spfResult === "fail" || spfResult === "permerror") spfPenalty += 15;
    else if (spfResult === "softfail" || spfResult === "neutral") spfPenalty += 5;

    if ((spf.alignment ?? "unknown") === "not_aligned") spfPenalty += 5;

    const lookups = typeof spf.dns_lookup_count === "number" ? spf.dns_lookup_count : 0;
    if (lookups > 10) spfPenalty += 5;
  }

  // -----------------
  // DKIM penalties (Verified-only)
  // -----------------
  let dkimPenalty = 0;
  const dkimMeasured = verified && Boolean(checks.dkim);
  const dkim = checks.dkim ?? {};
  const dkimPresent = dkimMeasured && dkim.present === true;
  const dkimResult = (dkim.result ?? "unknown") as "pass" | "fail" | "unknown";

  if (dkimMeasured) {
    if (!dkimPresent) {
      dkimPenalty += 20;
    } else {
      if (dkimResult === "fail") dkimPenalty += 20;
      if ((dkim.alignment ?? "unknown") === "not_aligned") dkimPenalty += 10;
    }
  }

  // -----------------
  // Transport penalties (only if measured)
  // -----------------
  let transportPenalty = 0;

  const mxMeasured = verified && ("mx" in checks);
  if (mxMeasured) {
    const mxTlsSupported = checks.mx?.tls?.supported;
    if (mxTlsSupported === false) transportPenalty += 10;
  }

  const mtaStsMeasured = verified && ("mta_sts" in checks);
  if (mtaStsMeasured) {
    const mtaStsPresent = checks.mta_sts?.present === true;
    if (!mtaStsPresent) transportPenalty += 5;
  }

  // -----------------
  // Reputation penalties (only if measured)
  // -----------------
  let reputationPenalty = 0;
  const blacklistsMeasured = verified && ("blacklists" in checks);
  const listed = blacklistsMeasured && checks.blacklists?.listed === true;
  if (listed) reputationPenalty += 30;

  // -----------------
  // Bonus (cap +5)
  // -----------------
  let bonus = 0;

  if ((dmarc.alignment_mode ?? "unknown") === "strict") bonus += 3;

  const selectors = dkim.selectors_checked ?? [];
  if (selectors.length >= 2) bonus += 2;

  if (checks.mta_sts?.policy_mode === "enforce") bonus += 2;
  if (checks.tlsrpt?.present === true) bonus += 1;
  if (checks.bimi?.present === true) bonus += 2;

  if (bonus > 5) bonus = 5;

  // -----------------
  // Total score
  // -----------------
  const rawScore =
    100 - (dmarcPenalty + dkimPenalty + spfPenalty + transportPenalty + reputationPenalty) + bonus;

  const score = clampScore(rawScore);
  const status = statusFromScore(score);

  // -----------------
  // Signals for campaign risk mapping
  // -----------------
  const dmarcEnforced = dmarcPresent && (dmarcPolicy === "quarantine" || dmarcPolicy === "reject");

  const dkimFailMeasured = dkimMeasured && dkimPresent && dkimResult === "fail";

  const authCritical =
    (!dmarcPresent || dmarcPolicy === "none") ||
    (spfPresent && (spfResult === "fail" || spfResult === "permerror")) ||
    dkimFailMeasured;

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
      reputation: reputationPenalty,
    },
    signals: {
      dmarc_enforced: dmarcEnforced,
      auth_critical: authCritical,
      blacklisted,
    },
  };
}
