// apps/runner/src/pdf/sections/howToRead.ts
import { buildPdfModel, escInline, planLabel } from "../utils/reportModel.js";

export function renderHowToReadSection(report: any): string {
  const m = buildPdfModel(report);

  return `
  <section class="section">
    <div class="card">
      <h2>How to read this report</h2>

      <div class="muted">
        This report combines <b>email</b> and <b>website</b> signals to estimate campaign risk.
        The goal is to prevent deliverability issues (spam/throttling) and conversion loss (slow or unstable landing pages).
      </div>

      <div class="grid" style="grid-template-columns: 1fr 1fr; margin-top:10px;">
        <div>
          <h2>Basic scan</h2>
          <ul class="list">
            <li>DNS-based checks (SPF/DMARC)</li>
            <li>Website HTTP sampling (TTFB/cache/redirects)</li>
            <li>No email header analysis</li>
          </ul>
        </div>

        <div>
          <h2>Verified scan</h2>
          <ul class="list">
            <li>Includes Basic scan checks</li>
            <li>Email evidence + header validation</li>
            <li>DKIM / SPF / DMARC alignment</li>
            <li>Provider signals (when available)</li>
          </ul>
        </div>
      </div>

      <div class="meta" style="margin-top:10px;">
        Your current report is based on: <b>${escInline(planLabel(m.plan))}</b>.
      </div>
    </div>
  </section>
  `;
}