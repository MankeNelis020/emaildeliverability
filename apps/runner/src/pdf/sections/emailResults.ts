export function renderEmailResultsSection(report: any): string {
  const hasInbound = Boolean(report?.email_scan && Object.keys(report.email_scan).length);

  if (!hasInbound) {
    return `
      <div class="card section">
        <h2>Email results</h2>
        <div class="muted">
          No inbound email evidence captured yet.
        </div>
        <div class="muted" style="margin-top:6px;">
          Run a <b>Verified</b> scan to capture and validate a real test email
          (SPF, DKIM, DMARC alignment and provider delivery signals).
        </div>
      </div>
    `;
  }

  return `
    <div class="card section">
      <h2>Email results</h2>
      <div class="muted">
        Inbound evidence is present, but rendering is not implemented yet.
      </div>
    </div>
  `;
}