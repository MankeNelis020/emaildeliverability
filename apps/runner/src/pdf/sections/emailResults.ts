function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function authBadge(result: string | undefined): string {
  if (!result) return `<span class="badge-neutral">—</span>`;
  const cls =
    result === "pass"
      ? "badge-pass"
      : result === "fail"
      ? "badge-fail"
      : "badge-warn";
  return `<span class="${cls}">${esc(result.toUpperCase())}</span>`;
}

export function renderEmailResultsSection(report: any): string {
  const ev = report?.verified_evidence ?? null;
  const plan = report?.inputs?.plan ?? "basic";

  // ---- Basic scan: show DNS-level email auth from emailAuth scan ----
  const emailAuth = report?.email_auth ?? null;
  const spf = emailAuth?.spf ?? null;
  const dmarc = emailAuth?.dmarc ?? null;

  const dnsSection =
    spf || dmarc
      ? `
    <div class="card section">
      <h2>Email authentication (DNS)</h2>
      <div class="intro">
        DNS-level checks verify whether your domain has SPF and DMARC records configured correctly.
        These are necessary but not sufficient — a Verified scan adds live delivery evidence.
      </div>
      <table class="table" style="margin-top:12px">
        <thead>
          <tr>
            <th>Protocol</th>
            <th>Present</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>SPF</b></td>
            <td>${spf?.present ? '<span class="badge-pass">YES</span>' : '<span class="badge-fail">NO</span>'}</td>
            <td><code>${esc(spf?.record ?? "—")}</code></td>
          </tr>
          <tr>
            <td><b>DMARC</b></td>
            <td>${dmarc?.present ? '<span class="badge-pass">YES</span>' : '<span class="badge-fail">NO</span>'}</td>
            <td>
              policy: <b>${esc(dmarc?.policy ?? "—")}</b>
              ${dmarc?.pct != null ? ` · pct: ${esc(dmarc.pct)}%` : ""}
              <br/><code style="font-size:10px">${esc(dmarc?.record ?? "—")}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
      : "";

  // ---- Verified scan: show live delivery evidence ----
  if (!ev) {
    if (plan !== "verified") {
      return dnsSection
        ? dnsSection
        : `
        <div class="card section">
          <h2>Email results</h2>
          <div class="muted">
            No email authentication data found. Run a scan with a valid sending domain to see SPF and DMARC results.
          </div>
        </div>
      `;
    }

    // Verified plan but no evidence yet
    return `
      ${dnsSection}
      <div class="card section">
        <h2>Verified email evidence — pending</h2>
        <div class="muted">
          No inbound test email received yet. Send a test email from your sending domain
          to the unique inbound address provided after checkout to complete verification.
        </div>
        <div class="muted" style="margin-top:6px;">
          Once received, this section will show live DKIM, SPF, DMARC alignment,
          TLS transport details and the raw <code>Authentication-Results</code> header.
        </div>
      </div>
    `;
  }

  // ---- Verified evidence present ----
  const dkim = ev.auth?.dkim;
  const spfEv = ev.auth?.spf;
  const dmarcEv = ev.auth?.dmarc;
  const tls = ev.tls;

  return `
    ${dnsSection}
    <div class="card section">
      <h2>Verified email evidence</h2>
      <div class="intro">
        This section shows the authentication results from a live test email received
        at the inbound verification address. These results reflect what a real recipient
        mailbox sees when your emails arrive.
      </div>

      <table class="table" style="margin-top:12px">
        <thead>
          <tr>
            <th>Check</th>
            <th>Result</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>DKIM</b></td>
            <td>${authBadge(dkim?.result)}</td>
            <td>
              ${dkim?.domain ? `domain: <b>${esc(dkim.domain)}</b>` : ""}
              ${dkim?.selector ? ` · selector: <b>${esc(dkim.selector)}</b>` : ""}
            </td>
          </tr>
          <tr>
            <td><b>SPF</b></td>
            <td>${authBadge(spfEv?.result)}</td>
            <td>
              ${spfEv?.ip ? `client IP: <b>${esc(spfEv.ip)}</b>` : ""}
            </td>
          </tr>
          <tr>
            <td><b>DMARC</b></td>
            <td>${authBadge(dmarcEv?.result)}</td>
            <td>
              ${dmarcEv?.policy ? `policy: <b>${esc(dmarcEv.policy)}</b>` : ""}
            </td>
          </tr>
          ${
            tls?.version
              ? `
          <tr>
            <td><b>TLS</b></td>
            <td><span class="badge-pass">${esc(tls.version)}</span></td>
            <td>${tls.cipher ? esc(tls.cipher) : ""}</td>
          </tr>
          `
              : ""
          }
        </tbody>
      </table>

      <div class="section" style="margin-top:14px">
        <div class="h2">Delivery metadata</div>
        <div class="kv" style="font-size:12px; margin-top:6px">
          <div><b>From:</b> ${esc(ev.from || "—")}</div>
          <div><b>Received at:</b> ${esc(ev.received_at ? new Date(ev.received_at).toUTCString() : "—")}</div>
          ${ev.message_id ? `<div><b>Message-ID:</b> <code style="font-size:10px">${esc(ev.message_id)}</code></div>` : ""}
          ${ev.subject ? `<div><b>Subject:</b> ${esc(ev.subject)}</div>` : ""}
        </div>
      </div>

      ${
        ev.raw_authentication_results
          ? `
      <div class="section" style="margin-top:14px">
        <div class="h2">Raw Authentication-Results header</div>
        <pre style="font-size:9px; white-space:pre-wrap; word-break:break-all; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-top:6px;">${esc(ev.raw_authentication_results)}</pre>
      </div>
      `
          : ""
      }
    </div>
  `;
}
