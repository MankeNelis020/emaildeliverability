import { esc } from "../utils/esc.js";
import { buildPdfModel } from "../utils/reportModel.js";

export function renderOverviewSection(report: any): string {

  const m = buildPdfModel(report);

  const scanId = m.scanId ?? "—";
  const generatedAt = m.generatedAt ?? "—";
  const headline = m.headline ?? "—";
  const verdict = m.verdict ?? "—";
  const confidence = m.confidence ?? "—";

  const ready = Boolean(report?.ready_to_send);

  return `
  <div class="top">
    <div>
      <div class="brand">Campaign Readiness Report</div>
      <div class="meta">Scan ID: ${esc(scanId)} · Generated: ${esc(generatedAt)}</div>
    </div>
    <div class="right">
      ${readyBadge(ready)}
      <div class="meta">Overall score: <b>${m.overallPct}</b></div>
    </div>
  </div>

  <div class="grid">
    <!-- LEFT -->
    <div class="card">
      <h2>Overview</h2>
      <p class="headline">${esc(headline)}</p>
      <div class="subline">Verdict: <b>${esc(verdict)}</b> · Confidence: <b>${esc(confidence)}</b></div>
    </div>

    <!-- RIGHT -->
    <div class="stack">

      <div class="card">
        <h2>How to read this report</h2>
        <div class="muted">
          This report summarizes email + website signals that influence campaign deliverability and conversion.
          <br/><br/>
          <b>Note:</b> Some sections may be empty if no evidence was captured yet.
        </div>
      </div>
    </div>
  </div>
`;
}

function readyBadge(ready: boolean): string {
  const cls = ready ? "good" : "bad";
  const label = ready ? "READY TO SEND" : "DO NOT SEND";
  return `<span class="pill ${cls}">${label}</span>`;
}

