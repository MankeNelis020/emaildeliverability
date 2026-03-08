// apps/runner/src/pdf/sections/toc.ts
import { buildPdfModel, escInline } from "../utils/reportModel.js";

export function renderTocSection(report: any): string {
  const m = buildPdfModel(report);

  const items = [
    "How to read this report",
    "What we scan & why it matters",
    "Executive summary (Abstract)",
    "Email authentication results",
    "Website results",
    ...(m.plan === "verified" ? ["Email evidence (Verified)"] : []),
    "Scoring & thresholds explained",
    "Conclusions & next steps",
  ];

  return `
  <section class="section">
    <div class="card">
      <h2>Contents</h2>
      <ol class="toc">
        ${items.map((x) => `<li>${escInline(x)}</li>`).join("")}
      </ol>
      <div class="meta" style="margin-top:8px;">
        Note: Sections may be omitted if no evidence was captured for that part of the scan.
      </div>
    </div>
  </section>
  `;
}