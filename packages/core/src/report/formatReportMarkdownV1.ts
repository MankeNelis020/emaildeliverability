// packages/core/src/report/formatReportMarkdownV1.ts


import type { ReportV1 } from "./generateReportV1.js";


function esc(s: any) {
  return String(s ?? "").replace(/\r/g, "").trim();
}


export function formatReportMarkdownV1(report: ReportV1): string {
  const lines: string[] = [];


  lines.push(`# Campaign Readiness Report`);
  lines.push(``);
  lines.push(`- **Scan ID:** ${esc(report.scan_id)}`);
  lines.push(`- **Generated:** ${esc(report.generated_at)}`);
  lines.push(`- **Verdict:** ${esc(String(report.verdict).toUpperCase())}`);
  lines.push(`- **Confidence:** ${esc(report.confidence)}`);
  lines.push(`- **Ready to send:** ${report.ready_to_send ? "Yes" : "No"}`);
  lines.push(``);


  lines.push(`## Summary`);
  lines.push(`${esc(report.headline)}`);
  lines.push(``);


  lines.push(`## Scores`);
  lines.push(`- Email readiness: **${report.scores.email.score}/100** (${esc(report.scores.email.status)})`);
  lines.push(`- Website readiness: **${report.scores.website.score}/100** (${esc(report.scores.website.status)})`);
  lines.push(
    `- Campaign risk: **${esc(String(report.scores.campaign.level).toUpperCase())}** (${report.scores.campaign.score}/100)`
  );
  lines.push(``);


  lines.push(`## Why this verdict`);
  if (report.why?.length) {
    for (const w of report.why) lines.push(`- ${esc(w)}`);
  } else {
    lines.push(`- No additional reasoning available.`);
  }
  lines.push(``);


  lines.push(`## Blockers`);
  if (report.blockers?.length) {
    for (const b of report.blockers) {
      lines.push(`- **${esc(b.severity)}** · ${esc(b.message)} _(id: ${esc(b.id)})_`);
    }
  } else {
    lines.push(`- None`);
  }
  lines.push(``);


  lines.push(`## Recommended actions`);
  if (report.top_actions?.length) {
    report.top_actions.forEach((a, i) => {
      lines.push(`### ${i + 1}. ${esc(a.title)}`);
      lines.push(`- **Impact:** ${esc(a.impact)} · **Effort:** ${esc(a.effort)}`);
      lines.push(`- **Why:** ${esc(a.why)}`);
      if (a.steps?.length) {
        lines.push(``);
        lines.push(`Steps:`);
        for (const s of a.steps) lines.push(`- ${esc(s)}`);
      }
      lines.push(``);
    });
  } else {
    lines.push(`- None`);
    lines.push(``);
  }


  return lines.join("\n");
}
