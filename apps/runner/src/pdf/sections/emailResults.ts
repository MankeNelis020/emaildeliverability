import { esc } from "../utils/esc.js";

export function renderEmailResultsSection(report: any): string {
  const emailScan = report?.email_scan;
  const checks = emailScan?.checks;

  if (!checks) {
    // Determine whether to show "send test email" instruction or just "no data"
    const isVerified = report?.inputs?.plan === "verified" || report?.inputs?.sku === "verified";
    const inboundStatus = (report as any)?.inbound_status;
    const verifyAddress = (report as any)?.verify_address;

    if (isVerified || inboundStatus === "pending") {
      return `
        <div class="card section">
          <h2>Email results</h2>
          <div class="meta">Verified scan — waiting for test email</div>
          <div class="note" style="margin-top:8px;">
            <b>Send your test email</b><br/>
            To capture live authentication signals, send a real test email to:<br/>
            <span class="mono" style="font-size:13px; font-weight:700;">${esc(verifyAddress ?? "verify+&lt;scanId&gt;@inbound.example.com")}</span>
            <br/><br/>
            Once received, this section will show DKIM, SPF, DMARC alignment and TLS transport results.
          </div>
        </div>
      `;
    }

    return `
      <div class="card section">
        <h2>Email results</h2>
        <div class="meta">No inbound email evidence captured yet.</div>
        <div class="muted" style="margin-top:6px;">
          Run a <b>Verified</b> scan to capture and validate a real test email
          (SPF, DKIM, DMARC alignment and provider delivery signals).
        </div>
      </div>
    `;
  }

  // Full evidence table
  const spf = checks.spf ?? {};
  const dkim = checks.dkim ?? {};
  const dmarc = checks.dmarc ?? {};
  const tls = checks.mx?.tls ?? {};
  const receivedAt = emailScan?.inbound_received_at ?? null;

  const badge = (ok: boolean | null, label: string) => {
    if (ok === null) return `<span class="muted">${esc(label)}</span>`;
    return ok
      ? `<span style="color:#065f46;font-weight:700;">${esc(label)}</span>`
      : `<span style="color:#991b1b;font-weight:700;">${esc(label)}</span>`;
  };

  const alignBadge = (a: string | undefined) => {
    if (!a || a === "unknown") return `<span class="muted">unknown</span>`;
    return a === "aligned"
      ? `<span style="color:#065f46;font-weight:700;">aligned</span>`
      : `<span style="color:#991b1b;font-weight:700;">not aligned</span>`;
  };

  const resultBadge = (result: string | undefined, present: boolean | undefined) => {
    if (!present && !result) return `<span class="muted">not present</span>`;
    if (!result || result === "none" || result === "unknown") return `<span class="muted">${esc(result ?? "—")}</span>`;
    if (result === "pass") return `<span style="color:#065f46;font-weight:700;">pass</span>`;
    if (result === "fail") return `<span style="color:#991b1b;font-weight:700;">fail</span>`;
    return `<span class="muted">${esc(result)}</span>`;
  };

  const selectorsList = Array.isArray(dkim.selectors_checked) && dkim.selectors_checked.length
    ? `<span class="mono">${dkim.selectors_checked.map(esc).join(", ")}</span>`
    : `<span class="muted">—</span>`;

  return `
    <div class="card section">
      <h2>Email results</h2>
      <div class="meta">Live inbound authentication evidence${receivedAt ? ` · received ${esc(receivedAt)}` : ""}</div>

      <table class="table" style="margin-top:10px;">
        <thead>
          <tr>
            <th style="width:110px;">Check</th>
            <th style="width:80px;">Present</th>
            <th style="width:100px;">Result</th>
            <th style="width:120px;">Alignment</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>DKIM</b></td>
            <td>${badge(dkim.present === true, dkim.present ? "yes" : "no")}</td>
            <td>${resultBadge(dkim.result, dkim.present)}</td>
            <td>${alignBadge(dkim.alignment)}</td>
            <td><span class="muted">Selector: </span>${selectorsList}</td>
          </tr>
          <tr>
            <td><b>SPF</b></td>
            <td>${badge(spf.present === true, spf.present ? "yes" : "no")}</td>
            <td>${resultBadge(spf.result, spf.present)}</td>
            <td>${alignBadge(spf.alignment)}</td>
            <td><span class="muted">Envelope domain: </span><span class="mono">${esc(spf.domain ?? "—")}</span></td>
          </tr>
          <tr>
            <td><b>DMARC</b></td>
            <td>${badge(dmarc.present === true, dmarc.present ? "yes" : "no")}</td>
            <td>${badge(dmarc.present === true, dmarc.present ? "enforced" : "none")}</td>
            <td><span class="muted">${esc(dmarc.alignment_mode ?? "unknown")}</span></td>
            <td>
              <span class="muted">Policy: </span><span class="mono">${esc(dmarc.policy ?? "—")}</span>
              &nbsp;·&nbsp;
              <span class="muted">pct: </span><span class="mono">${esc(typeof dmarc.pct === "number" ? dmarc.pct + "%" : "—")}</span>
            </td>
          </tr>
          <tr>
            <td><b>Transport (TLS)</b></td>
            <td>${badge(tls.supported === true, tls.supported ? "yes" : "no")}</td>
            <td>${badge(tls.supported === true, tls.supported ? "ESMTPS" : "not detected")}</td>
            <td><span class="muted">—</span></td>
            <td><span class="muted">${tls.supported ? "TLS encrypted delivery confirmed via Received headers" : "No ESMTPS detected in Received headers"}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}
