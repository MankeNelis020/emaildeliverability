// apps/runner/src/pdf/sections/abstract.ts
import { esc } from "../utils/esc.js";

function parseDmarcPolicyFromRecord(record: unknown): string {
  if (!record) return "unknown";
  const s = String(record).toLowerCase();
  const m = s.match(/\bp\s*=\s*(none|quarantine|reject)\b/);
  return m?.[1] ?? "unknown";
}

function parseDmarcPctFromRecord(record: unknown): number | null {
  if (!record) return null;
  const s = String(record).toLowerCase();
  const m = s.match(/\bpct\s*=\s*(\d{1,3})\b/);
  if (!m) return 100;

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function dmarcStrength(policy: string, pct: number | null): string {
  if (policy === "reject" && pct === 100) return "Strong";
  if (policy === "quarantine" && (pct ?? 100) >= 100) return "Moderate";
  if (policy === "quarantine") return "Moderate";
  if (policy === "none") return "Weak";
  return "Unknown";
}

function isVerifiedReport(report: any): boolean {
  const plan = String(
    report?.inputs?.plan ?? report?.inputs?.sku ?? report?.inputs?.product ?? ""
  ).toLowerCase();

  if (plan.includes("verified")) return true;
  if (report?.email_scan?.checks?.dkim) return true;
  if (report?.inbound_email || report?.email_evidence) return true;
  return false;
}

export function renderAbstractSection(report: any): string {
  const verdict = report?.verdict ?? "—";
  const confidence = report?.confidence ?? "—";
  const overall =
    report?.scores?.campaign?.score ??
    report?.scores?.campaign_risk?.score ??
    null;

  const inputs = report?.inputs ?? {};
  const hostname = inputs?.hostname ?? "—";
  const websiteUrl = inputs?.website_url ?? "—";
  const sendingEmail = inputs?.sending_email ?? "—";
  const contactEmail = inputs?.contact_email ?? "—";

  const emailAuth = report?.email_auth ?? null;

  const spfPresent = emailAuth?.spf?.present === true;
  const spfRecord = emailAuth?.spf?.record ?? null;

  const dmarcPresent = emailAuth?.dmarc?.present === true;
  const dmarcRecord = emailAuth?.dmarc?.record ?? null;
  const dmarcPolicy =
    emailAuth?.dmarc?.policy ??
    parseDmarcPolicyFromRecord(dmarcRecord);
  const dmarcPct =
    typeof emailAuth?.dmarc?.pct === "number"
      ? emailAuth.dmarc.pct
      : parseDmarcPctFromRecord(dmarcRecord);
  const dmarcPolicyStrength = dmarcPresent
    ? dmarcStrength(dmarcPolicy, dmarcPct)
    : "Missing";

  const verified = isVerifiedReport(report);

  const blockers: any[] = Array.isArray(report?.blockers) ? report.blockers : [];
  const topBlockers = blockers.slice(0, 3).map((b) => b?.message).filter(Boolean);

  const websiteSamples =
    report?.website_scan?.aggregates?.http?.samples ??
    report?.website_scan?.http?.samples ??
    [];
  const hasWebsite = Array.isArray(websiteSamples) && websiteSamples.length > 0;

  const hasEmailEvidence = Boolean(report?.email_evidence || report?.email_scan || report?.inbound_email);

  const fmtPct = (x: any) => (typeof x === "number" ? `${Math.round(x)}%` : "—");

  return `
    <div class="grid" style="margin-top:16px;">
      <div class="card">
        <h2>Abstract</h2>
        <div class="muted">
          Verdict: <b>${esc(verdict)}</b> · Confidence: <b>${esc(confidence)}</b> · Overall: <b>${esc(fmtPct(overall))}</b>
        </div>

        <div style="margin-top:10px;">
          <ul class="list">
            ${
              topBlockers.length
                ? topBlockers.map((x) => `<li>${esc(x)}</li>`).join("")
                : `<li>No critical blockers detected.</li>`
            }
            <li>Website evidence: <b>${hasWebsite ? "captured" : "not captured"}</b>.</li>
            <li>Email evidence: <b>${hasEmailEvidence ? "captured" : "not captured"}</b>.</li>
          </ul>
        </div>

        <div class="divider"></div>

        <div class="section-title">Email authentication (DNS)</div>
        <div class="section-sub">Basic scan validates SPF and DMARC via DNS. DKIM requires a Verified scan (email/header evidence).</div>

        <ul class="kv">
          <li><span>SPF</span><b>${spfPresent ? "present" : "missing"}</b></li>
          <li><span>DMARC</span><b>${dmarcPresent ? `present (p=${esc(dmarcPolicy)})` : "missing"}</b></li>
          <li><span>DMARC strength</span><b>${esc(dmarcPolicyStrength)}</b></li>
          <li><span>DMARC coverage</span><b>${dmarcPresent ? esc(fmtPct(dmarcPct)) : "—"}</b></li>
          <li><span>DKIM</span><b>${verified ? "evaluated (Verified)" : "not evaluated (Basic)"}</b></li>
        </ul>

        ${
          spfPresent && spfRecord
            ? `<div class="note"><div class="small muted"><b>SPF record</b></div><div class="mono small wrap">${esc(spfRecord)}</div></div>`
            : ""
        }

        ${
          dmarcPresent && dmarcRecord
            ? `<div class="note"><div class="small muted"><b>DMARC record</b></div><div class="mono small wrap">${esc(dmarcRecord)}</div></div>`
            : ""
        }

        ${
          verified
            ? ""
            : `<div class="note">
                 <div class="small"><b>Want DKIM + header validation?</b></div>
                 <div class="muted small">Run a Verified scan to validate DKIM, SPF alignment, and read email headers (more accurate deliverability signals).</div>
               </div>`
        }
      </div>

      <div class="card">
        <h2>Client inputs</h2>
        <table class="table">
          <tbody>
            <tr><th style="width:160px;">Hostname</th><td class="mono wrap">${esc(hostname)}</td></tr>
            <tr><th>Website URL</th><td class="mono wrap">${esc(websiteUrl)}</td></tr>
            <tr><th>Sending email</th><td class="mono wrap">${esc(sendingEmail)}</td></tr>
            <tr><th>Contact email</th><td class="mono wrap">${esc(contactEmail)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
