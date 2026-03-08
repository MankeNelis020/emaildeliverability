// apps/runner/src/pdf/sections/whatWeScan.ts
import { buildPdfModel, escInline, yesNoUnknown } from "../utils/reportModel.js";

export function renderWhatWeScanSection(report: any): string {
  const m = buildPdfModel(report);

  return `
  <section class="page-break">
    <div class="card">
      <h2>What we scan & why it matters</h2>

      <div class="grid" style="grid-template-columns: 1fr 1fr; margin-top:12px;">
        <div class="card">
          <h2>Email deliverability</h2>
          <div class="muted">
            Authentication reduces spoofing risk and improves inbox placement. Missing or weak policies increase spam filtering and throttling risk.
          </div>

          <table class="table" style="margin-top:10px;">
            <thead>
              <tr><th>Check</th><th>Why it matters</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="mono">SPF</td>
                <td>Allows senders and prevents spoofing</td>
                <td><b>${escInline(yesNoUnknown(m.spfPresent))}</b></td>
              </tr>
              <tr>
                <td class="mono">DMARC</td>
                <td>Policy enforcement & reporting</td>
                <td><b>${escInline(yesNoUnknown(m.dmarcPresent))}</b>${m.dmarcPolicy ? ` · policy=<span class="mono">${escInline(m.dmarcPolicy)}</span>` : ""}</td>
              </tr>
              <tr>
                <td class="mono">DKIM</td>
                <td>Message integrity & alignment</td>
                <td><b>${escInline(m.plan === "verified" ? yesNoUnknown(m.dkimPresent) : "Not evaluated (Basic)")}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Website performance</h2>
          <div class="muted">
            During campaigns, traffic spikes. Slow server responses reduce conversion and may cause timeouts. Cache behavior affects consistency under load.
          </div>

          <table class="table" style="margin-top:10px;">
            <thead>
              <tr><th>Signal</th><th>Why it matters</th><th>Measured</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="mono">TTFB</td>
                <td>Server responsiveness under load</td>
                <td><b>${escInline(m.hasWebsiteEvidence ? "Yes" : "Not captured")}</b></td>
              </tr>
              <tr>
                <td class="mono">Cache</td>
                <td>Consistency & performance</td>
                <td><b>${escInline(m.hasWebsiteEvidence ? "Yes" : "Not captured")}</b></td>
              </tr>
              <tr>
                <td class="mono">Redirects</td>
                <td>Extra latency and instability</td>
                <td><b>${escInline(m.hasWebsiteEvidence ? "Yes" : "Not captured")}</b></td>
              </tr>
            </tbody>
          </table>

          <div class="meta" style="margin-top:10px;">
            Next: we compare results against thresholds and translate them into a score + actions.
          </div>
        </div>
      </div>
    </div>
  </section>
  `;
}