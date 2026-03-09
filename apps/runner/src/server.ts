// server.ts

import "dotenv/config";
import { createPurchase, getPurchase, updatePurchase } from "./purchaseStore.js";

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { scanWebsiteHttp } from "@crs/scanners";
import { scanEmailAuth } from "@crs/scanners";
import Stripe from "stripe";
import { htmlToPdf } from "./pdf.js";


// ✅ Gebruik scanStore zodat inbound later kan updaten
import { createScanStore, generateReportV1 } from "@crs/core";
import { renderReportHtml } from "./pdf/renderReportHtml.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as any,
});


console.log("Stripe key loaded:", !!process.env.STRIPE_SECRET_KEY);


type PaymentStatus = "unpaid" | "paid" | "freebeta";


type Blocker = { id: string; message: string; severity?: "hard" | "soft" };
type Warning = { id: string; message: string };


type ReportV1 = any;


// Wat we bewaren per scanId (in-memory cache voor snelle reads)
// De source of truth blijft scanStore op disk.
type StoredReport = ReportV1 & {
  payment_status: PaymentStatus;
  purchase_id?: string;
  stripe_session_id?: string;


  // extra input velden voor “bedrijfsgegevens” in de PDF
  inputs?: {
    hostname?: string;
    website_url?: string;
    sending_email?: string;
    contact_email?: string;
  };
};


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// PDF artifacts map
const ARTIFACT_DIR = process.env.SCAN_ARTIFACT_DIR
  ? path.resolve(process.env.SCAN_ARTIFACT_DIR)
  : path.resolve(__dirname, "..", "artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });


function pdfPathFor(scanId: string) {
  return path.join(ARTIFACT_DIR, `${scanId}.report.pdf`);
}


// Scan store (gedeeld met inbound als je dezelfde dir gebruikt)
const STORE_DIR = process.env.SCAN_STORE_DIR
  ? path.resolve(process.env.SCAN_STORE_DIR)
  : path.resolve(__dirname, "..", "..", "..", "data", "scans");


const store = createScanStore(STORE_DIR);


// in-memory caches
const reports = new Map<string, StoredReport>();


function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function pctFromScores(report: StoredReport): number {
  // Kies een “overall” voor je badge.
  // Ik pak campaign score als die er is, anders gemiddelde van email+website.
  const c = Number(report?.scores?.campaign?.score);
  if (Number.isFinite(c)) return clamp01(c / 100) * 100;


  const e = Number(report?.scores?.email?.score);
  const w = Number(report?.scores?.website?.score);
  if (Number.isFinite(e) && Number.isFinite(w)) return clamp01((e + w) / 200) * 100;


  return 0;
}


function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}


function readinessBadge(pct: number) {
  // Jouw voorstel:
  // >= 66.6% groen, 33.0–66.6 geel, <33 rood
  if (pct >= 66.6) return { label: "READY TO SEND", tone: "green", value: "YES" };
  if (pct >= 33.0) return { label: "READY TO SEND", tone: "yellow", value: "CAUTION" };
  return { label: "READY TO SEND", tone: "red", value: "NO" };
}


function formatMs(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)} ms`;
}


// Website evidence tabel (3x no-cache + 3x cache) als je die later opslaat.
// Dit renderen we alvast “future-proof”.
function renderWebsiteEvidence(report: StoredReport) {
  const agg = report?.website_evidence ?? report?.website_scan?.aggregates ?? report?.website_scan ?? null;


  // Probeer een paar mogelijke shapes:
  const noCacheRuns: any[] =
    agg?.no_cache?.runs ??
    agg?.no_cache?.samples ??
    agg?.no_cache ??
    report?.website_scan?.no_cache?.runs ??
    [];


  const cacheRuns: any[] =
    agg?.cache?.runs ??
    agg?.cache?.samples ??
    agg?.cache ??
    report?.website_scan?.cache?.runs ??
    [];


  const hasAny = Array.isArray(noCacheRuns) && noCacheRuns.length > 0 || Array.isArray(cacheRuns) && cacheRuns.length > 0;


  if (!hasAny) {
    return `
      <div class="note">
        <b>Website performance evidence</b><br/>
        No measurements captured yet. Once the website scan is connected, this section will show:
        <ul>
          <li>3× no-cache runs (TTFB, status, timings)</li>
          <li>3× cache runs (TTFB, status, cache behavior)</li>
          <li>p95 summaries and stability verdict</li>
        </ul>
      </div>
    `;
  }


  const rows = Math.max(noCacheRuns.length, cacheRuns.length, 3);


  const cell = (run: any) => {
    if (!run) return `<div class="muted">—</div>`;
    const status = run.status ?? run.http_status ?? run.code ?? "—";
    const ttfb = run.ttfb_ms ?? run.timings?.ttfb_ms ?? run.ttfb ?? "—";
    const cache = run.cache_status ?? run.cf_cache_status ?? run.cache ?? "—";
    const edge = run.edge_ttl_ms ?? run.edge_cache_ttl_ms ?? run.edge ?? null;
    return `
      <div><b>Status:</b> ${esc(status)}</div>
      <div><b>TTFB:</b> ${esc(formatMs(ttfb))}</div>
      <div><b>Cache:</b> ${esc(cache)}</div>
      <div><b>Edge:</b> ${edge != null ? esc(formatMs(edge)) : "—"}</div>
    `;
  };


  let body = "";
  for (let i = 0; i < rows; i++) {
    body += `
      <tr>
        <td class="colhead">Run ${i + 1}</td>
        <td>${cell(noCacheRuns[i])}</td>
        <td>${cell(cacheRuns[i])}</td>
      </tr>
    `;
  }


  return `
    <div class="section">
      <div class="h2">Website performance evidence</div>
      <div class="intro">
        This section compares performance <b>without cache</b> vs <b>with cache</b>.
        We run multiple requests to reduce noise and surface stability issues during send windows.
      </div>


      <table class="table">
        <thead>
          <tr>
            <th style="width: 90px"></th>
            <th>No-cache (origin)</th>
            <th>Cache (edge)</th>
          </tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>
  `;
}


function reportToHtml(report: StoredReport) {
  const blockers: Blocker[] = Array.isArray(report.blockers) ? report.blockers : [];
  const warnings: Warning[] = Array.isArray(report.warnings) ? report.warnings : [];
  const pct = pctFromScores(report);
  const badge = readinessBadge(pct);


  const companyWebsite = report?.inputs?.website_url ?? (report?.inputs?.hostname ? `https://${report.inputs.hostname}` : "");
  const sendingEmail = report?.inputs?.sending_email ?? "";
  const contactEmail = report?.inputs?.contact_email ?? "";


  const emailScore = report?.scores?.email?.score;
  const webScore = report?.scores?.website?.score;
  const campaignScore = report?.scores?.campaign?.score;


  const why: string[] = Array.isArray(report.why) ? report.why : [];
  const actions: any[] = Array.isArray(report.top_actions) ? report.top_actions : [];


  const badgeClass =
    badge.tone === "green" ? "badge green" :
    badge.tone === "yellow" ? "badge yellow" :
    "badge red";


  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Campaign Readiness Report</title>
<style>
  :root {
    --ink:#111;
    --muted:#4b5563;
    --line:#e5e7eb;
    --panel:#f9fafb;
  }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:var(--ink); margin: 28px; }
  .topbar { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding-bottom:14px; border-bottom:1px solid var(--line); }
  .brand { font-weight: 800; letter-spacing: .02em; font-size: 14px; }
  .meta { color:var(--muted); font-size: 11px; margin-top:4px; }
  .right { text-align:right; }
  .badge { display:inline-block; padding:10px 12px; border-radius:12px; font-weight:800; font-size:12px; letter-spacing:.04em; }
  .badge.green { background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; }
  .badge.yellow { background:#fffbeb; color:#92400e; border:1px solid #fcd34d; }
  .badge.red { background:#fef2f2; color:#991b1b; border:1px solid #fecaca; }
  .badge small { display:block; font-weight:700; letter-spacing:.02em; opacity:.8; margin-top:2px; }
  .grid { display:grid; grid-template-columns: 1.2fr .8fr; gap:16px; margin-top:16px; }
  .card { border:1px solid var(--line); border-radius:14px; padding:14px 14px; background:#fff; }
  .card h3 { margin:0 0 8px; font-size: 12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .kv { font-size: 12px; line-height: 1.5; }
  .kv b { font-weight: 700; }
  .scores { display:flex; gap:10px; flex-wrap:wrap; margin-top:8px; }
  .score { border:1px solid var(--line); border-radius:12px; padding:10px 12px; min-width: 140px; background:var(--panel); }
  .score .label { font-size: 11px; color:var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .score .value { font-size: 20px; font-weight: 800; margin-top: 6px; }
  .section { margin-top: 18px; }
  .h2 { font-size: 12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:8px; }
  .intro { font-size: 12px; color:#111; background:var(--panel); border:1px solid var(--line); padding:10px 12px; border-radius:12px; }
  ul { margin: 8px 0 0 18px; }
  li { margin: 3px 0; font-size: 12px; }
  .hard { font-weight:700; }
  .muted { color: var(--muted); }
  .note { font-size: 12px; border:1px dashed var(--line); padding:12px; border-radius:12px; background:#fff; }
  .table { width:100%; border-collapse:collapse; margin-top:10px; }
  .table th, .table td { border:1px solid var(--line); padding:10px; vertical-align:top; font-size: 12px; }
  .table th { background:var(--panel); text-align:left; }
  .colhead { font-weight:800; color:#111; background:#fff; }
  .footer { margin-top: 26px; border-top:1px solid var(--line); padding-top: 12px; display:flex; justify-content:space-between; gap:16px; align-items:flex-end;}
  .small { font-size: 10px; color: var(--muted); }
  .advisor { display:flex; gap:10px; align-items:center; }
  .avatar { width:40px; height:40px; border-radius:999px; background:var(--panel); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; font-weight:800; color:var(--muted); }
  .cta { font-size: 12px; font-weight:700; }
</style>
</head>
<body>


<div class="topbar">
  <div>
    <div class="brand">Campaign Readiness Scanner</div>
    <div class="meta">
      Scan ID: <b>${esc(report.scan_id)}</b> · Generated: <b>${esc(report.generated_at)}</b>
    </div>
  </div>


  <div class="right">
    <div class="${badgeClass}">
      ${esc(badge.label)}<br/>
      <span style="font-size:16px">${esc(badge.value)}</span>
      <small>Overall: ${pct.toFixed(1)}%</small>
    </div>
  </div>
</div>


<div class="grid">
  <div class="card">
    <h3>Overview</h3>
    <div class="kv">
      <div><b>Company website:</b> ${companyWebsite ? esc(companyWebsite) : `<span class="muted">Not provided</span>`}</div>
      <div><b>Sending domain/email:</b> ${sendingEmail ? esc(sendingEmail) : `<span class="muted">Not provided</span>`}</div>
      <div><b>Contact email for report:</b> ${contactEmail ? esc(contactEmail) : `<span class="muted">Not provided</span>`}</div>
      <div class="muted" style="margin-top:6px">
        If any of the above is incorrect, re-run the scan with the correct details.
      </div>
    </div>


    <div class="scores">
      <div class="score">
        <div class="label">Email readiness</div>
        <div class="value">${Number.isFinite(Number(emailScore)) ? `${Number(emailScore)}/100` : "—"}</div>
      </div>
      <div class="score">
        <div class="label">Website readiness</div>
        <div class="value">${Number.isFinite(Number(webScore)) ? `${Number(webScore)}/100` : "—"}</div>
      </div>
      <div class="score">
        <div class="label">Campaign risk</div>
        <div class="value">${Number.isFinite(Number(campaignScore)) ? `${Number(campaignScore)}/100` : "—"}</div>
      </div>
    </div>


    <div class="section">
      <div class="h2">Headline</div>
      <div class="intro">
        <b>${esc(report.headline)}</b><br/>
        <span class="muted">
          Verdict: ${esc(report.verdict)} · Confidence: ${esc(report.confidence)}
        </span>
      </div>
    </div>
  </div>


  <div class="card">
    <h3>How to read this report</h3>
    <div class="kv">
      <div class="muted">
        <b>Intro text</b> explains what a section means and what “good” usually looks like.
        <br/>
        <b>Evidence</b> is your measured data (DNS findings, headers, HTTP timings).
      </div>


      <div class="section">
        <div class="h2">Email authentication primer</div>
        <div class="intro">
          <b>SPF</b> lists allowed sending sources. <b>DKIM</b> signs messages cryptographically.
          <b>DMARC</b> enforces alignment and policy (none → quarantine/reject).
          Strong authentication reduces spoofing and improves inbox placement.
        </div>
      </div>
    </div>
  </div>
</div>


<div class="section">
  <div class="h2">Blockers</div>
  <div class="intro">
    These issues should be fixed before sending. Blockers are “hard stops” under a conservative B2B policy.
  </div>
  <div class="card" style="margin-top:10px">
    <ul>
      ${
        blockers.length
          ? blockers.map((b) => `<li class="hard">${esc(b.message)}</li>`).join("")
          : "<li>None</li>"
      }
    </ul>
  </div>
</div>


<div class="section">
  <div class="h2">Warnings</div>
  <div class="intro">
    Warnings are improvements that can lift performance or reduce risk, but may not fully block a send.
  </div>
  <div class="card" style="margin-top:10px">
    <ul>
      ${
        warnings.length
          ? warnings.map((w) => `<li>${esc(w.message)}</li>`).join("")
          : "<li>None</li>"
      }
    </ul>
  </div>
</div>


<div class="section">
  <div class="h2">Why this verdict</div>
  <div class="intro">
    A short summary of the main signals that influenced the verdict.
  </div>
  <div class="card" style="margin-top:10px">
    <ul>
      ${
        why.length
          ? why.map((t) => `<li>${esc(t)}</li>`).join("")
          : "<li>No summary available.</li>"
      }
    </ul>
  </div>
</div>


${renderWebsiteEvidence(report)}


<div class="section">
  <div class="h2">Top actions</div>
  <div class="intro">
    The fastest path to improving the “Ready to send” outcome.
  </div>
  <div class="card" style="margin-top:10px">
    ${
      actions.length
        ? actions.map((a) => `
          <div style="margin: 0 0 12px;">
            <div style="font-weight:800;">${esc(a.title ?? a.id ?? "Action")}</div>
            <div class="muted" style="font-size:12px; margin-top:2px">${esc(a.why ?? "")}</div>
            ${Array.isArray(a.steps) ? `<ul>${a.steps.map((s: string) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
          </div>
        `).join("")
        : `<div class="muted">No actions available.</div>`
    }
  </div>
</div>


<div class="footer">
  <div class="small">
    <div><b>Your company</b>: <span class="muted">[Your company name]</span></div>
    <div><b>Address</b>: <span class="muted">[Street, City]</span></div>
    <div><b>VAT / CoC</b>: <span class="muted">[Optional]</span></div>
  </div>


  <div class="advisor">
    <div class="avatar">A</div>
    <div>
      <div class="cta">Get in touch with one of our advisors</div>
      <div class="small">Reply to this email or visit: <span class="muted">[your website/contact]</span></div>
    </div>
  </div>
</div>


</body>
</html>`;
}


function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://www.sendshield.nl",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}


function handleOptions(res: import("node:http").ServerResponse) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "https://www.sendshield.nl",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

import { normalizeWebsiteUrl } from "@crs/scanners";

// Create + persist scan (so inbound can patch later)
function makeInitialScan(scanId: string, hostname: string, sending_email?: string, contact_email?: string) {
  const website_url = normalizeWebsiteUrl(hostname, { stripPath: true, stripQuery: true, stripHash: true });
  return {
    schema_version: "1.0",
    scan_id: scanId,
    created_at: new Date().toISOString(),
    inputs: {
      website_url,
      sending_email: sending_email || "",
      contact_email: contact_email || "",
      send_window: { enabled: false, timezone: "Europe/Amsterdam" },
    },
    email_scan: {},
    website_scan: {},
    scores: {
      email_readiness: { score: 0, max: 100 },
      website_readiness: { score: 0, max: 100 },
      campaign_risk: { level: "low", score: 0, max: 100 },
    },
    meta: { run_mode: "single", scanner_region: "local", runtime_ms: 0 },
  };
}


const server = createServer((req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "Invalid request" });
    return;
  }


  if (req.method === "OPTIONS") {
    handleOptions(res);
    return;
  }


  const APP_URL = process.env.APP_URL; // http://localhost:8787
  const url = new URL (req.url, APP_URL)

  // HEALTH
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "runner-api", time: new Date().toISOString() });
    return;
  }


// CREATE SCAN + PDF
if (req.method === "POST" && url.pathname === "/api/scan") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));


  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}") as {
        hostname?: string;
        sending_email?: string;
        contact_email?: string;
      };


      if (!payload.hostname) {
        sendJson(res, 400, { error: "hostname required" });
        return;
      }


      const scanId = randomUUID();


      // 1) save scan in store (source of truth)
      const scan = makeInitialScan(
        scanId,
        payload.hostname,
        payload.sending_email,
        payload.contact_email
      );
      store.save(scanId, scan);

      // 1a) EMAIL AUTH (SPF + DMARC) — hoort bij Basic scan
try {
  const emailAuth = await scanEmailAuth(payload.hostname);
  (scan as any).email_auth = emailAuth;
} catch (e) {
  console.warn("[CRS] email auth scan failed:", String((e as any)?.message ?? e));
  (scan as any).email_auth = null;
}


// persist scan update
store.save(scanId, scan);


      console.log("[CRS] website scan starting:", scan.inputs.website_url);

      // 1b) capture website evidence (optional)
      try {
        const websiteEvidence = await scanWebsiteHttp(scan.inputs.website_url, {
          noCacheSamples: 3,
          cacheSamples: 3,
        });
        
        console.log(
          "[CRS] websiteEvidence samples:",
          websiteEvidence?.aggregates?.http?.samples?.length,
          "summary:",
          !!websiteEvidence?.aggregates?.http?.summary
        );
        
       

        

        (scan as any).website_scan = websiteEvidence;
      } catch (e) {
        console.log("[CRS] website scan failed:", String((e as any)?.message ?? e));
        // website evidence is optional → we continue
      }
      

      // optional: keep timeline/debug
      scan.meta = {
        ...scan.meta,
        runtime_ms: Date.now() - new Date(scan.created_at).getTime(),
      };


      // persist updated scan (with or without website evidence)
      store.save(scanId, scan);


// 2) generate report from scan
const report: StoredReport = {
  ...generateReportV1({
    ...scan,
    // 🔑 belangrijk: maak inputs compleet (plan/sku behouden) + jouw payload velden toevoegen
    inputs: {
      ...(scan as any).inputs,

      // 👇 jouw bestaande velden
      hostname: payload.hostname,
      website_url: (scan as any).inputs?.website_url,
      sending_email: (scan as any).inputs?.sending_email,
      contact_email: (scan as any).inputs?.contact_email,

      // ✅ expliciet plan/sku borgen (Basic default)
      plan:
        (scan as any).inputs?.plan ??
        (payload as any)?.plan ??
        (payload as any)?.sku ??
        "basic",
    },
  } as any),

  payment_status: "unpaid",

  // ✅ laat report.inputs staan (voor PDF/client inputs),
  // maar OVERSCHRIJF NIET meer de hele inputs zonder merge
  inputs: {
    ...(scan as any).inputs,
    hostname: payload.hostname,
    website_url: (scan as any).inputs?.website_url,
    sending_email: (scan as any).inputs?.sending_email,
    contact_email: (scan as any).inputs?.contact_email,
    plan:
      (scan as any).inputs?.plan ??
      (payload as any)?.plan ??
      (payload as any)?.sku ??
      "basic",
  },
};


      // expose evidence in report JSON (handig voor debug en PDF)
(report as any).email_auth = (scan as any).email_auth ?? null;


      // ✅ ensure website evidence is available in the rendered report + /api/scan/:id JSON
(report as any).website_scan = (scan as any).website_scan


      // also store a report json next to scan (handig, maar niet kritisch)
      try {
        const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      } catch (err) {
        console.warn("[CRS] failed to write report.json", scanId, String(err));
      }


      // cache report in memory
      reports.set(scanId, report);


      // 3) PDF (core step)
      const html = renderReportHtml(report);
      const pdfPath = pdfPathFor(scanId);


      console.log("[CRS] writing pdf:", pdfPath);
      await htmlToPdf(html, pdfPath);


      const exists = fs.existsSync(pdfPath);
      console.log("[CRS] pdf written:", pdfPath, "exists:", exists);


      if (!exists) {
        throw new Error(`PDF generation reported success but file missing: ${pdfPath}`);
      }


      sendJson(res, 200, { scanId });
    } catch (e: any) {
      sendJson(res, 400, {
        error: "Scan failed",
        detail: String(e?.message ?? e),
      });
    }
  });


  return;
}


// DEV ONLY: mark scan as paid
if (
  req.method === "POST" &&
  url.pathname.startsWith("/api/scan/") &&
  url.pathname.endsWith("/mark-paid")
) {
  const scanId = url.pathname.replace("/api/scan/", "").replace("/mark-paid", "").trim();
  if (!scanId) {
    sendJson(res, 400, { error: "scanId missing" });
    return;
  }


  const r = reports.get(scanId);
  if (!r) {
    sendJson(res, 404, { error: "Report not found", scanId });
    return;
  }


  r.payment_status = "paid";
  reports.set(scanId, r);


  sendJson(res, 200, { ok: true, scanId, payment_status: "paid" });
  return;
}


// CREATE STRIPE CHECKOUT SESSION
if (req.method === "POST" && url.pathname === "/api/checkout/create-session") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));


  req.on("end", async () => {
    let parsed: { sku?: "basic" | "verified"; scanId?: string };
  
  
    try {
      parsed = JSON.parse(body || "{}");
    } catch (e) {
      sendJson(res, 400, { error: "Invalid JSON body", detail: String(e) });
      return;
    }
  
  
    try {
      const sku = parsed.sku;
      const scanId = parsed.scanId;
  
  
      if (!sku || (sku !== "basic" && sku !== "verified")) {
        sendJson(res, 400, { error: "sku must be 'basic' or 'verified'" });
        return;
      }
  
  
      const priceId =
        sku === "verified"
          ? process.env.STRIPE_PRICE_VERIFIED
          : process.env.STRIPE_PRICE_BASIC;
  
  
      if (!priceId) {
        sendJson(res, 500, { error: "Price not configured" });
        return;
      }
  
  
      if (!process.env.APP_URL) {
        sendJson(res, 500, { error: "APP_URL not configured" });
        return;
      }
  
  
      const purchaseId = randomUUID();

      // purchase opslaan (pending)
      createPurchase({
        purchaseId,
        sku,
        status: "pending",
        created_at: new Date().toISOString(),
      });
      
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL}/checkout/success?purchaseId=${purchaseId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/checkout/cancel?purchaseId=${purchaseId}`,
        metadata: { purchaseId, sku, scanId: scanId ?? "" },
      });
  
  
      sendJson(res, 200, { url: session.url, purchaseId });
    } catch (e) {
      sendJson(res, 500, {
        error: "Failed to create Stripe checkout session",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
  
  return;
}


// PDF gate (payment required)
if (
  req.method === "GET" &&
  url.pathname.startsWith("/api/scan/") &&
  url.pathname.endsWith("/report.pdf")
) {
  const scanId = url.pathname.replace("/api/scan/", "").replace("/report.pdf", "").trim();


  if (!scanId) {
    sendJson(res, 400, { error: "scanId missing" });
    return;
  }


  const report = reports.get(scanId);
  if (!report) {
    sendJson(res, 404, { error: "Report not found", scanId });
    return;
  }


  if (report.payment_status !== "paid" && report.payment_status !== "freebeta") {
    sendJson(res, 402, { error: "Payment required", scanId });
    return;
  }


  const p = pdfPathFor(scanId);
  if (!fs.existsSync(p)) {
    sendJson(res, 404, { error: "PDF not found", scanId });
    return;
  }

  if (!fs.existsSync(p)) {
    sendJson(res, 202, { status: "processing", scanId });
    return;
  }


  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${scanId}.report.pdf"`,
    "Access-Control-Allow-Origin": "https://www.sendshield.nl",
  });


  fs.createReadStream(p).pipe(res);
  return;
}


// JSON report
if (req.method === "GET" && url.pathname.startsWith("/api/scan/")) {
  const scanId = url.pathname.replace("/api/scan/", "").trim();


  if (!scanId) {
    sendJson(res, 400, { error: "scanId missing" });
    return;
  }
  
  const report = reports.get(scanId);
  if (!report) {
    sendJson(res, 404, { error: "Report not found", scanId });
    return;
  }


  sendJson(res, 200, report);
  return;
}


// fallback
sendJson(res, 404, { error: "Not found" });
}); // <-- sluit createServer callback netjes af


const PORT = Number(process.env.PORT || 8787);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Runner API listening on port ${PORT}`);
});
