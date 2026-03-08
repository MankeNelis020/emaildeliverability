// apps/runner/src/pdf/sections/cover.ts
import { buildPdfModel, escInline, planLabel } from "../utils/reportModel.js";

export function renderCoverSection(report: any): string {
  const m = buildPdfModel(report);

  return `
  <section class="page-break">
    <div class="cover">
      <div class="cover-top">
        <div class="cover-title">Campaign Readiness Report</div>
        <div class="cover-sub">Email deliverability & website performance assessment</div>
      </div>

      <div class="cover-mid">
        <div class="cover-score">
          <div class="cover-score-label">Overall score</div>
          <div class="cover-score-value">${m.overallPct}</div>
          <div class="cover-badge">
            <span class="pill ${m.badge.tone}">${escInline(m.badge.label)}</span>
          </div>
        </div>

        <div class="cover-meta card">
          <h2>Scan details</h2>
          <div class="kv">
            <div class="k">Plan</div><div class="v">${escInline(planLabel(m.plan))}</div>
            <div class="k">Scan ID</div><div class="v mono">${escInline(m.scanId)}</div>
            <div class="k">Generated</div><div class="v">${escInline(m.generatedAt)}</div>
            <div class="k">Hostname</div><div class="v mono">${escInline(m.hostname)}</div>
            <div class="k">Website URL</div><div class="v mono">${escInline(m.websiteUrl)}</div>
          </div>
        </div>
      </div>

      <div class="cover-bottom card">
        <h2>Executive headline</h2>
        <div class="headline">${escInline(m.headline)}</div>
        <div class="meta" style="margin-top:8px;">
          Verdict: <b>${escInline(m.verdict)}</b> · Confidence: <b>${escInline(m.confidence)}</b>
        </div>
      </div>
    </div>
  </section>
  `;
}
