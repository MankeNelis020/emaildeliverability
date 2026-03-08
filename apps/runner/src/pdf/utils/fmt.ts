// apps/runner/src/pdf/utils/fmt.ts

export function fmtPct(x: number | null | undefined): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

export function fmtMs(x: number | null | undefined): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${Math.round(x)} ms`;
}


type AnyObj = Record<string, any>;


type Blocker = { id?: string; severity?: string; message: string };
type Warning = { id?: string; message: string };


function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSamples(report: any) {
  // we support both shapes: report.website_scan.aggregates.http.samples or report.website_scan.http.samples
  const samples =
    report?.website_scan?.aggregates?.http?.samples ??
    report?.website_scan?.http?.samples ??
    [];
  return Array.isArray(samples) ? samples : [];
}


// === Website evidence section (P2.2) ===


function renderWebsiteEvidenceSection(report: any) {
  const ws = report?.website_scan || report?.websiteScan || report?.websiteEvidence;
  if (!ws?.aggregates?.http?.samples?.length) {
    return `
      <div class="card">
        <h2>Website performance evidence</h2>
        <p class="muted">
          No website evidence captured yet. (This report can include 3× no-cache + 3× cache measurements.)
        </p>
      </div>
    `;
  }


  const samples: any[] = ws.aggregates.http.samples || [];
  const noCache = samples.filter((s) => s.mode === "no-cache");
  const cache = samples.filter((s) => s.mode === "cache");


  const summary = ws.aggregates.http.summary;
  const p95No = summary?.no_cache?.p95?.ttfb_ms ?? null;
  const p95Cache = summary?.cache?.p95?.ttfb_ms ?? null;


  const delta =
    typeof p95No === "number" && typeof p95Cache === "number"
      ? p95No - p95Cache
      : null;


  const cacheAgg = ws.aggregates.cache;
  const consistentHit = cacheAgg?.consistent_hit;
  const hits = cacheAgg?.sample_hits ?? null;
  const total = cacheAgg?.sample_total ?? null;


  const intro = `
    <div class="card">
      <h2>Website performance evidence</h2>
      <p class="muted">
        We measure <b>Time to First Byte (TTFB)</b> and cache behavior to estimate how fast recipients will load your landing page
        when the campaign goes out. This scan runs <b>3× no-cache</b> (cold) and <b>3× cache</b> (warm) requests.
      </p>
    </div>
  `;


  const table = `
    <div class="card">
      <div class="evidence-grid">
        <div>
          <h3>No-cache (cold)</h3>
          ${renderRunList(noCache)}
        </div>
        <div>
          <h3>Cache (warm)</h3>
          ${renderRunList(cache)}
        </div>
        <div>
          <h3>Summary</h3>
          <ul class="kv">
            <li><span>P95 TTFB (no-cache)</span><b>${fmtMs(p95No)}</b></li>
            <li><span>P95 TTFB (cache)</span><b>${fmtMs(p95Cache)}</b></li>
            <li><span>Estimated improvement</span><b>${delta === null ? "—" : fmtMs(delta)}</b></li>
            <li><span>Cache consistency</span><b>${fmtBool(consistentHit)}</b></li>
            <li><span>Hit samples</span><b>${hits === null || total === null ? "—" : `${hits}/${total}`}</b></li>
          </ul>
          ${renderCacheNotes(cacheAgg?.notes)}
        </div>
      </div>


      <div class="divider"></div>


      <h3>How to interpret cache signals</h3>
      <ul class="muted">
        <li><b>HIT</b>: served from edge cache (fastest).</li>
        <li><b>BYPASS</b>: cache was skipped (cookies/headers/config). Often means inconsistent performance.</li>
        <li><b>DYNAMIC</b>: not cacheable content or origin-rendered response. Expect higher TTFB.</li>
      </ul>
    </div>
  `;


  return intro + table;
}


function renderRunList(runs: any[]) {
  if (!runs?.length) return `<p class="muted">No samples.</p>`;


  return `
    <ol class="runs">
      ${runs
        .map((s, i) => {
          const status = s.status ?? "—";
          const ttfb = fmtMs(s.ttfb_ms ?? null);
          const redirects = typeof s.redirects === "number" ? s.redirects : 0;
          const cacheLabel = cacheLabelFromHeaders(s.cache_headers || {}, s.cache_hit);


          const ok = !!s.ok;
          const badge = ok ? `<span class="pill ok">OK</span>` : `<span class="pill bad">Issue</span>`;
          const err = s.error ? `<div class="muted small">Error: ${esc(s.error)}</div>` : "";


          return `
            <li>
              <div class="runrow">
                <div>${badge}</div>
                <div class="mono">#${i + 1}</div>
                <div>Status: <b>${esc(status)}</b></div>
                <div>TTFB: <b>${esc(ttfb)}</b></div>
                <div>Redirects: <b>${esc(redirects)}</b></div>
                <div>Cache: <b>${esc(cacheLabel)}</b></div>
              </div>
              ${err}
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}


function fmtBool(x: any) {
  if (x === true) return "Yes";
  if (x === false) return "No";
  return "—";
}


function renderCacheNotes(notes?: string[]) {
  if (!notes?.length) return "";
  return `
    <div class="note">
      <b>Notes</b>
      <ul>
        ${notes.map((n) => `<li>${esc(n)}</li>`).join("")}
      </ul>
    </div>
  `;
}


function cacheLabelFromHeaders(headers: Record<string, string | null>, cacheHit: boolean | null) {
  const joined = Object.entries(headers || {})
    .map(([k, v]) => `${String(k).toLowerCase()}:${String(v ?? "").toLowerCase()}`)
    .join(" | ");


  if (joined.includes("cf-cache-status:hit") || joined.includes("x-cache:hit") || joined.includes("hit")) return "HIT";
  if (joined.includes("bypass") || joined.includes("cf-cache-status:bypass")) return "BYPASS";
  if (joined.includes("dynamic") || joined.includes("cf-cache-status:dynamic")) return "DYNAMIC";


  if (cacheHit === true) return "HIT";
  if (cacheHit === false) return "MISS/BYPASS";
  return "Unknown";
}



function pct(n: any) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : null;
  return v == null ? "—" : `${Math.round(v)}%`;
}


function statusPill(label: string, kind: "good" | "warn" | "bad" | "neutral") {
  const cls =
    kind === "good"
      ? "pill good"
      : kind === "warn"
        ? "pill warn"
        : kind === "bad"
          ? "pill bad"
          : "pill neutral";
  return `<span class="${cls}">${esc(label)}</span>`;
}


function readyBadge(ready: boolean | undefined, overallScorePct?: number) {
  // Jij wilde: groen vanaf ~66.6%, geel ertussen, rood laag.
  const score = typeof overallScorePct === "number" ? overallScorePct : null;


  if (ready === true) return statusPill("READY TO SEND: YES", "good");
  if (score != null) {
    if (score >= 67) return statusPill("READY TO SEND: YES", "good");
    if (score >= 33) return statusPill("READY TO SEND: MAYBE", "warn");
    return statusPill("READY TO SEND: NO", "bad");
  }
  return statusPill(ready ? "READY TO SEND: YES" : "READY TO SEND: NO", ready ? "good" : "bad");
}


function renderKpiCard(title: string, value: string, sub?: string) {
  return `
    <div class="kpi">
      <div class="kpi-title">${esc(title)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}
    </div>
  `;
}


function safeArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}


function websiteEvidenceTable(report: AnyObj) {
  const samples = safeArray<any>(report?.website_scan?.aggregates?.http?.samples);
  if (!samples.length) {
    return `
      <div class="muted">
        No website HTTP evidence captured yet.
        <br/>Tip: ensure <code>scanWebsiteHttp(scan.inputs.website_url, { noCacheSamples: 3, cacheSamples: 3 })</code> runs and is stored into <code>scan.website_scan</code>.
      </div>
    `;
  }


  // Verwacht 3x no-cache + 3x cache (maar we renderen wat er is)
  const rows = samples
    .map((s) => {
      const mode = s.mode ?? "—";
      const status = s.status ?? "—";
      const ttfb = typeof s.ttfb_ms === "number" ? `${Math.round(s.ttfb_ms)} ms` : "—";
      const hit = s.cache_hit === true ? "hit" : s.cache_hit === false ? "miss/bypass" : "—";
      const url = s.url ?? "—";
      return `
        <tr>
          <td>${esc(mode)}</td>
          <td class="mono">${esc(String(status))}</td>
          <td class="mono">${esc(ttfb)}</td>
          <td>${esc(hit)}</td>
          <td class="mono small">${esc(url)}</td>
        </tr>
      `;
    })
    .join("");


  return `
    <div class="card">
      <div class="section-title">Website evidence (HTTP samples)</div>
      <div class="section-sub">3× no-cache + 3× cache measurements (as available)</div>


      <table class="table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Status</th>
            <th>TTFB</th>
            <th>Cache</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}


function blockersList(blockers: Blocker[]) {
  if (!blockers.length) return `<div class="muted">None</div>`;
  return `
    <ul class="list">
      ${blockers
        .map((b) => `<li><b>${esc(b.severity ? b.severity.toUpperCase() : "BLOCKER")}:</b> ${esc(b.message)}</li>`)
        .join("")}
    </ul>
  `;
}


function warningsList(warnings: Warning[]) {
  if (!warnings.length) return `<div class="muted">None</div>`;
  return `
    <ul class="list">
      ${warnings.map((w) => `<li>${esc(w.message)}</li>`).join("")}
    </ul>
  `;
}


/**
 * Export name must match your import in server.ts:
 *   import { renderReportHtml } from "./pdf/renderReportHtml";
 */
export function renderReportHtml(report: AnyObj) {
  const blockers = safeArray<Blocker>(report?.blockers);
  const warnings = safeArray<Warning>(report?.warnings);


  const scanId = report?.scan_id ?? "—";
  const generatedAt = report?.generated_at ?? "—";
  const headline = report?.headline ?? "—";
  const verdict = report?.verdict ?? "—";
  const confidence = report?.confidence ?? "—";
  const ready = report?.ready_to_send;


  const scoreEmail = report?.scores?.email?.score;
  const scoreWeb = report?.scores?.website?.score;
  const scoreCampaign = report?.scores?.campaign?.score;


  // jouw “overall 25%”
  const overall = typeof scoreCampaign === "number" ? scoreCampaign : null;


  // inputs (zoals jij in StoredReport.inputs zet)
  const hostname = report?.inputs?.hostname ?? "";
  const websiteUrl = report?.inputs?.website_url ?? "";
  const sendingEmail = report?.inputs?.sending_email ?? "";
  const contactEmail = report?.inputs?.contact_email ?? "";

  const samples = getSamples(report);
const noCache = samples.filter((s: any) => s?.mode === "no-cache");
const cache = samples.filter((s: any) => s?.mode === "cache");


function row(s: any) {
  const cf = s?.cache_headers?.["cf-cache-status"] ?? "—";
  const xCache = s?.cache_headers?.["x-cache"] ?? "—";
  const age = s?.cache_headers?.["age"] ?? "—";


  return `
    <tr>
      <td>${esc(s?.mode ?? "—")}</td>
      <td>${s?.status ?? "—"}</td>
      <td>${fmtMs(s?.ttfb_ms)}</td>
      <td>${s?.redirects ?? "—"}</td>
      <td>${s?.cache_hit === true ? "HIT" : s?.cache_hit === false ? "MISS" : "—"}</td>
      <td>${esc(String(cf))}</td>
      <td>${esc(String(xCache))}</td>
      <td>${esc(String(age))}</td>
    </tr>
  `;
}


const websiteEvidenceHtml = `
  <h2>Website performance evidence</h2>
  <div class="meta">
    We ran ${noCache.length}× no-cache and ${cache.length}× cache samples. This makes results repeatable and comparable.
  </div>


  <div class="card">
    <h3 style="margin:0 0 8px; font-size:13px;">No-cache samples</h3>
    ${noCache.length ? `
      <table style="width:100%; border-collapse: collapse; font-size:12px;">
        <thead>
          <tr>
            <th align="left">Mode</th>
            <th align="left">Status</th>
            <th align="left">TTFB</th>
            <th align="left">Redirects</th>
            <th align="left">Cache</th>
            <th align="left">CF</th>
            <th align="left">x-cache</th>
            <th align="left">age</th>
          </tr>
        </thead>
        <tbody>
          ${noCache.map(row).join("")}
        </tbody>
      </table>
    ` : `<div>No samples captured.</div>`}
  </div>


  <div class="card">
    <h3 style="margin:0 0 8px; font-size:13px;">Cache samples</h3>
    ${cache.length ? `
      <table style="width:100%; border-collapse: collapse; font-size:12px;">
        <thead>
          <tr>
            <th align="left">Mode</th>
            <th align="left">Status</th>
            <th align="left">TTFB</th>
            <th align="left">Redirects</th>
            <th align="left">Cache</th>
            <th align="left">CF</th>
            <th align="left">x-cache</th>
            <th align="left">age</th>
          </tr>
        </thead>
        <tbody>
          ${cache.map(row).join("")}
        </tbody>
      </table>
    ` : `<div>No samples captured.</div>`}
  </div>
`;



return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Campaign Readiness Report</title>
  <style>
    :root {
      --border:#e6e6e6;
      --text:#111;
      --muted:#555;
      --bg:#fff;
      --card:#fff;
      --pill-good:#0a7a2f;
      --pill-warn:#a96500;
      --pill-bad:#b42318;
      --pill-neutral:#444;
    }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: var(--text); background: var(--bg); margin: 0; }
    .page { padding: 24px; }


    .top { display:flex; gap:16px; align-items:flex-start; justify-content:space-between; }
    .brand { font-weight:700; font-size:16px; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .right { display:flex; flex-direction:column; gap:8px; align-items:flex-end; }
    .pill { display:inline-block; padding:8px 10px; border-radius:999px; color:#fff; font-weight:700; font-size:12px; letter-spacing:.02em; }
    .pill.good { background: var(--pill-good); }
    .pill.warn { background: var(--pill-warn); }
    .pill.bad { background: var(--pill-bad); }
    .pill.neutral { background: var(--pill-neutral); }


    .grid { display:grid; grid-template-columns: 1.25fr .75fr; gap:16px; margin-top:16px; }
    .card { border:1px solid var(--border); border-radius:14px; background:var(--card); padding:14px; }
    .card h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color: var(--muted); }


    .headline { font-size:18px; font-weight:800; margin:0; }
    .subline { margin-top:8px; color: var(--muted); font-size:13px; }


    .kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-top:12px; }
    .kpi { border:1px solid var(--border); border-radius:12px; padding:10px; }
    .kpi-title { color: var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .kpi-value { font-size:18px; font-weight:800; margin-top:6px; }
    .kpi-sub { font-size:12px; color: var(--muted); margin-top:4px; }


    .list { margin:8px 0 0 18px; }
    .list li { margin:6px 0; }
    .muted { color: var(--muted); font-size: 13px; }


    .table { width:100%; border-collapse: collapse; }
    .table th, .table td { border-top:1px solid var(--border); padding:8px; vertical-align:top; font-size:12px; }
    .table th { text-align:left; color: var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .small { font-size:11px; }


    .note { margin-top:10px; padding:10px; border:1px solid var(--border); border-radius:10px; }
    .divider{ margin: 14px 0; border-top:1px solid var(--border); }


    .footer { margin-top:18px; border-top:1px solid var(--border); padding-top:12px; display:flex; justify-content:space-between; gap:16px; color: var(--muted); font-size:12px; }
    .footer b { color: var(--text); }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div>
        <div class="brand">Campaign Readiness Report</div>
        <div class="meta">Scan ID: ${esc(scanId)} · Generated: ${esc(generatedAt)}</div>
      </div>
      <div class="right">
        ${readyBadge(Boolean(ready), overall ?? undefined)}
        <div class="meta">Overall score: <b>${pct(overall ?? undefined)}</b></div>
      </div>
    </div>


    <!-- 1) CLIENT INPUTS (FIRST) -->
    <div class="card" style="margin-top:16px;">
      <h2>Client inputs</h2>
      <table class="table">
        <tbody>
          <tr><th style="width:180px;">Hostname</th><td class="mono">${esc(hostname || "—")}</td></tr>
          <tr><th>Website URL</th><td class="mono">${esc(websiteUrl || "—")}</td></tr>
          <tr><th>Sending email</th><td class="mono">${esc(sendingEmail || "—")}</td></tr>
          <tr><th>Contact email</th><td class="mono">${esc(contactEmail || "—")}</td></tr>
        </tbody>
      </table>
      <div class="note muted">
        If any input above is incorrect, rerun the scan with the corrected values to avoid misleading recommendations.
      </div>
    </div>


    <!-- 2) ABSTRACT (AUTO-GENERATED) -->
    <div class="card" style="margin-top:16px;">
      <h2>Abstract</h2>
      <p class="headline">${esc(headline)}</p>


      <div class="subline">
        Verdict: <b>${esc(verdict)}</b> · Confidence: <b>${esc(confidence)}</b> · Ready to send: <b>${ready ? "Yes" : "No"}</b>
      </div>


      <div class="divider"></div>


      <div class="muted">
        ${(() => {
          const b = (Array.isArray(blockers) ? blockers : []);
          const w = (Array.isArray(warnings) ? warnings : []);
          const hasWebsite = Boolean((report as any)?.website_scan?.aggregates?.http?.samples?.length);
          const top = Array.isArray((report as any)?.top_actions) ? (report as any).top_actions : [];
          const why = Array.isArray((report as any)?.why) ? (report as any).why : [];


          const lines: string[] = [];


          // Key outcomes
          lines.push(`<b>Key outcomes</b>`);
          lines.push(`<ul class="list">`);
          lines.push(`<li><b>${pct(scoreEmail)}</b> email readiness, <b>${pct(scoreWeb)}</b> website readiness, and <b>${pct(scoreCampaign)}</b> campaign risk score.</li>`);
          lines.push(`<li>${b.length ? `<b>${b.length}</b> blocker(s) require action before sending.` : `No blockers detected.`}</li>`);
          lines.push(`<li>${hasWebsite ? `Website HTTP evidence captured (3× no-cache + 3× cache).` : `No website HTTP evidence captured in this run.`}</li>`);
          lines.push(`</ul>`);


          if (why.length) {
            lines.push(`<b>Primary drivers</b>`);
            lines.push(`<ul class="list">`);
            for (const item of why.slice(0, 3)) lines.push(`<li>${esc(item)}</li>`);
            lines.push(`</ul>`);
          }


          if (top.length) {
            lines.push(`<b>Recommended next actions</b>`);
            lines.push(`<ul class="list">`);
            for (const a of top.slice(0, 3)) lines.push(`<li><b>${esc(a.title ?? a.id ?? "Action")}</b> — ${esc(a.why ?? "")}</li>`);
            lines.push(`</ul>`);
          }


          if (!top.length && (b.length || w.length)) {
            lines.push(`<b>Next actions</b>`);
            lines.push(`<div class="muted">Address blockers first, then rerun the scan to verify improvements.</div>`);
          }


          return lines.join("");
        })()}
      </div>
    </div>


    <!-- 3) OVERVIEW + HOW TO READ -->
    <div class="grid">
      <div class="card">
        <h2>Overview</h2>
        <p class="headline">${esc(headline)}</p>
        <div class="subline">
          Verdict: <b>${esc(verdict)}</b> · Confidence: <b>${esc(confidence)}</b>
        </div>


        <div class="kpis">
          ${renderKpiCard("Email readiness", pct(scoreEmail), "0–100")}
          ${renderKpiCard("Website readiness", pct(scoreWeb), "0–100")}
          ${renderKpiCard("Campaign risk score", pct(scoreCampaign), "0–100")}
        </div>
      </div>


      <div class="card">
        <h2>How to read this report</h2>
        <div class="muted">
          This report summarizes email + website signals that influence campaign deliverability and conversion.
          <br/><br/>
          <b>Tip:</b> Use this report to create a repeatable baseline. After changes, rerun the scan and compare results.
          <br/><br/>
          <b>Note:</b> Some sections may be empty if no evidence was captured in this scan type.
        </div>
      </div>
    </div>


    <!-- 4) WEBSITE CHAPTER (ONLY KEEP THE “BEST / BOTTOM” VERSION) -->
    <div class="card" style="margin-top:16px;">
      <h2>Website</h2>
      <div class="muted">
        We measure HTTP Time to First Byte (TTFB), redirects, and cache signals to estimate how quickly users will load your landing page.
        This scan runs <b>3× no-cache</b> (cold) and <b>3× cache</b> (warm) requests to make results repeatable.
      </div>


      <div class="divider"></div>


      ${websiteEvidenceHtml}
    </div>


    <!-- 5) RECEIVED EMAIL CHAPTER (PLACEHOLDER IF NONE) -->
    <div class="card" style="margin-top:16px;">
      <h2>Received email</h2>


      ${(() => {
        // We don't know your exact inbound shape yet, so we check a few common locations.
        const r: any = report as any;
        const inbound =
          r?.email_inbound ||
          r?.email_scan?.inbound ||
          r?.email_scan?.received ||
          r?.email_scan?.raw_email;


        if (!inbound) {
          return `
            <div class="muted">
              No inbound email evidence was captured in this scan.
              <br/><br/>
              <b>Why this matters:</b> DNS signals (SPF/DKIM/DMARC) should ideally be verified against a real received message.
              With a received email we can parse headers (Authentication-Results, DKIM/SPF alignment, ARC, List-Unsubscribe, etc.)
              and provide evidence you can compare across reruns.
              <div class="note">
                <b>Upgrade path:</b> Run a <b>Verified</b> scan to send a test email and include header-based verification in this report.
              </div>
            </div>
          `;
        }


        return `
          <div class="muted">
            Inbound email evidence detected (structure pending). Next iteration: render header table + authentication alignment evidence here.
          </div>
        `;
      })()}
    </div>


    <!-- 6) BLOCKERS + WARNINGS -->
    <div class="grid" style="margin-top:16px;">
      <div class="card">
        <h2>Blockers</h2>
        ${blockersList(blockers)}
      </div>
      <div class="card">
        <h2>Warnings</h2>
        ${warningsList(warnings)}
      </div>
    </div>


    <div class="footer">
      <div>
        <b>Your company</b><br/>
        Company name · Address · VAT · Website
      </div>
      <div style="text-align:right;">
        <b>Get in touch</b><br/>
        advisor@yourdomain.com · +31 6 12345678
      </div>
    </div>
  </div>
</body>
</html>`;
}

