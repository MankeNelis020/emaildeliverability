// server.ts

import "dotenv/config";
import { createPurchase, getPurchase, updatePurchase, initPurchaseStore } from "./purchaseStore.js";

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

// Persist purchases in the same data directory
const PURCHASE_DIR = process.env.PURCHASE_DIR
  ? path.resolve(process.env.PURCHASE_DIR)
  : path.resolve(STORE_DIR, "..", "purchases");
initPurchaseStore(PURCHASE_DIR);

// CORS: accept comma-separated origins from env (APP_URL is the frontend URL)
const ALLOWED_ORIGINS: string[] = (
  process.env.ALLOWED_ORIGINS ||
  process.env.APP_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function resolveOrigin(req: import("node:http").IncomingMessage): string {
  const origin = String(req.headers.origin ?? "");
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // allow any localhost in dev
  if (
    process.env.NODE_ENV !== "production" &&
    origin.startsWith("http://localhost")
  )
    return origin;
  return ALLOWED_ORIGINS[0] ?? "*";
}

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


function corsHeaders(req: import("node:http").IncomingMessage) {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(req),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Stripe-Signature",
    "Vary": "Origin",
  };
}

function sendJson(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  status: number,
  payload: unknown
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

function handleOptions(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
) {
  res.writeHead(204, corsHeaders(req));
  res.end();
}

import { normalizeWebsiteUrl, parseAuthenticationResults } from "@crs/scanners";

// Create + persist scan (so inbound can patch later)
function makeInitialScan(
  scanId: string,
  hostname: string,
  sending_email?: string,
  contact_email?: string,
  plan?: string,
  inbound_test_url?: string,
  recipient_count?: number,
) {
  const website_url = normalizeWebsiteUrl(hostname, { stripPath: true, stripQuery: true, stripHash: true });
  return {
    schema_version: "1.0",
    scan_id: scanId,
    created_at: new Date().toISOString(),
    inputs: {
      website_url,
      sending_email: sending_email || "",
      contact_email: contact_email || "",
      plan: plan || "basic",
      inbound_test_url: inbound_test_url || null,
      recipient_count: recipient_count || null,
      send_window: { enabled: false, timezone: "Europe/Amsterdam" },
    },
    email_scan: {},
    website_scan: {},
    verified_evidence: null as null | {
      received_at: string;
      from: string;
      to: string;
      subject?: string;
      message_id?: string;
      auth: {
        dkim?: { result: string; domain?: string; selector?: string };
        spf?: { result: string; domain?: string; ip?: string };
        dmarc?: { result: string; policy?: string };
      };
      tls?: { version?: string; cipher?: string };
      raw_authentication_results?: string;
    },
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
    sendJson(req, res, 400, { error: "Invalid request" });
    return;
  }


  if (req.method === "OPTIONS") {
    handleOptions(req, res);
    return;
  }


  const APP_URL = process.env.APP_URL; // http://localhost:8787
  const url = new URL (req.url, APP_URL)

  // HEALTH
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(req, res, 200, { ok: true, service: "runner-api", time: new Date().toISOString() });
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
        plan?: "basic" | "verified";
        inbound_test_url?: string;
        recipient_count?: number;
      };


      if (!payload.hostname) {
        sendJson(req, res, 400, { error: "hostname required" });
        return;
      }


      const scanId = randomUUID();


      // 1) save scan in store (source of truth)
      const scan = makeInitialScan(
        scanId,
        payload.hostname,
        payload.sending_email,
        payload.contact_email,
        payload.plan,
        payload.inbound_test_url,
        payload.recipient_count,
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
const plan = payload.plan ?? "basic";
const report: StoredReport = {
  ...generateReportV1({
    ...scan,
    inputs: {
      ...(scan as any).inputs,
      hostname: payload.hostname,
      website_url: (scan as any).inputs?.website_url,
      sending_email: (scan as any).inputs?.sending_email,
      contact_email: (scan as any).inputs?.contact_email,
      plan,
    },
  } as any),

  // Direct scans (FREEBETA/dev) get freebeta access — paid flow uses /checkout/complete
  payment_status: "freebeta",

  inputs: {
    ...(scan as any).inputs,
    hostname: payload.hostname,
    website_url: (scan as any).inputs?.website_url,
    sending_email: (scan as any).inputs?.sending_email,
    contact_email: (scan as any).inputs?.contact_email,
    plan,
    inbound_test_url: payload.inbound_test_url ?? null,
    recipient_count: payload.recipient_count ?? null,
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


      sendJson(req, res, 200, { scanId });
    } catch (e: any) {
      sendJson(req, res, 400, {
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
    sendJson(req, res, 400, { error: "scanId missing" });
    return;
  }


  const r = reports.get(scanId);
  if (!r) {
    sendJson(req, res, 404, { error: "Report not found", scanId });
    return;
  }


  r.payment_status = "paid";
  reports.set(scanId, r);


  sendJson(req, res, 200, { ok: true, scanId, payment_status: "paid" });
  return;
}


// CREATE STRIPE CHECKOUT SESSION
if (req.method === "POST" && url.pathname === "/api/checkout/create-session") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));


  req.on("end", async () => {
    let parsed: {
      sku?: "basic" | "verified";
      hostname?: string;
      sending_email?: string;
      contact_email?: string;
      inbound_test_url?: string;
      recipient_count?: number;
    };

    try {
      parsed = JSON.parse(body || "{}");
    } catch (e) {
      sendJson(req, res, 400, { error: "Invalid JSON body", detail: String(e) });
      return;
    }

    try {
      const sku = parsed.sku;
      if (!sku || (sku !== "basic" && sku !== "verified")) {
        sendJson(req, res, 400, { error: "sku must be 'basic' or 'verified'" });
        return;
      }

      const priceId =
        sku === "verified"
          ? process.env.STRIPE_PRICE_VERIFIED
          : process.env.STRIPE_PRICE_BASIC;

      if (!priceId) {
        sendJson(req, res, 500, { error: "Price not configured" });
        return;
      }

      if (!process.env.APP_URL) {
        sendJson(req, res, 500, { error: "APP_URL not configured" });
        return;
      }

      const purchaseId = randomUUID();

      // Persist purchase including scan form data so /checkout/complete can use it
      createPurchase({
        purchaseId,
        sku,
        status: "pending",
        hostname: parsed.hostname,
        sending_email: parsed.sending_email,
        contact_email: parsed.contact_email,
        inbound_test_url: parsed.inbound_test_url,
        recipient_count: parsed.recipient_count,
        created_at: new Date().toISOString(),
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL}/checkout/success?purchaseId=${purchaseId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/checkout/cancel?purchaseId=${purchaseId}`,
        metadata: { purchaseId, sku },
      });

      // Save the Stripe session ID so /checkout/complete can verify it
      updatePurchase(purchaseId, { stripe_session_id: session.id });

      sendJson(req, res, 200, { url: session.url, purchaseId });
    } catch (e) {
      sendJson(req, res, 500, {
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
    sendJson(req, res, 400, { error: "scanId missing" });
    return;
  }


  const report = reports.get(scanId);
  if (!report) {
    sendJson(req, res, 404, { error: "Report not found", scanId });
    return;
  }


  if (report.payment_status !== "paid" && report.payment_status !== "freebeta") {
    sendJson(req, res, 402, { error: "Payment required", scanId });
    return;
  }


  const p = pdfPathFor(scanId);
  if (!fs.existsSync(p)) {
    sendJson(req, res, 404, { error: "PDF not found", scanId });
    return;
  }

  if (!fs.existsSync(p)) {
    sendJson(req, res, 202, { status: "processing", scanId });
    return;
  }


  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${scanId}.report.pdf"`,
    ...corsHeaders(req),
  });


  fs.createReadStream(p).pipe(res);
  return;
}


// JSON report
if (req.method === "GET" && url.pathname.startsWith("/api/scan/")) {
  const scanId = url.pathname.replace("/api/scan/", "").trim();

  if (!scanId) {
    sendJson(req, res, 400, { error: "scanId missing" });
    return;
  }

  // Try memory first, then fall back to disk (survives server restarts)
  let report = reports.get(scanId) ?? null;
  if (!report) {
    const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as StoredReport;
        reports.set(scanId, report); // warm the cache
      } catch {
        // corrupt file → fall through to 404
      }
    }
  }

  if (!report) {
    sendJson(req, res, 404, { error: "Report not found", scanId });
    return;
  }

  sendJson(req, res, 200, report);
  return;
}

if (req.method === "POST" && url.pathname === "/api/checkout/complete") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));


  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}") as {
        purchaseId?: string;
        // Frontend sends these; fallback to values stored in purchase record
        hostname?: string;
        sending_email?: string;
        contact_email?: string;
        inbound_test_url?: string;
        recipient_count?: number;
      };

      if (!payload.purchaseId) {
        sendJson(req, res, 400, { error: "purchaseId required" });
        return;
      }

      const purchase = getPurchase(payload.purchaseId);
      if (!purchase) {
        sendJson(req, res, 404, { error: "Purchase not found" });
        return;
      }

      if (!purchase.stripe_session_id) {
        sendJson(req, res, 400, { error: "Stripe session missing for purchase" });
        return;
      }

      const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id);
      if (session.payment_status !== "paid") {
        sendJson(req, res, 402, { error: "Payment not completed" });
        return;
      }

      updatePurchase(payload.purchaseId, { status: "paid", paid_at: new Date().toISOString() });

      // Merge payload with stored purchase data (purchase data takes lower priority — payload wins)
      const hostname = payload.hostname || purchase.hostname || "";
      if (!hostname) {
        sendJson(req, res, 400, { error: "hostname required" });
        return;
      }
      const sending_email = payload.sending_email ?? purchase.sending_email;
      const contact_email = payload.contact_email ?? purchase.contact_email;
      const inbound_test_url = payload.inbound_test_url ?? purchase.inbound_test_url;
      const recipient_count = payload.recipient_count ?? purchase.recipient_count;

      const scanId = randomUUID();

      const scan = makeInitialScan(
        scanId,
        hostname,
        sending_email,
        contact_email,
        purchase.sku,
        inbound_test_url,
        recipient_count,
      );

      store.save(scanId, scan);

      try {
        const emailAuth = await scanEmailAuth(hostname);
        (scan as any).email_auth = emailAuth;
      } catch (e) {
        console.warn("[CRS] email auth scan failed:", String((e as any)?.message ?? e));
        (scan as any).email_auth = null;
      }

      store.save(scanId, scan);

      try {
        const websiteEvidence = await scanWebsiteHttp(scan.inputs.website_url, {
          noCacheSamples: 3,
          cacheSamples: 3,
        });
        (scan as any).website_scan = websiteEvidence;
      } catch (e) {
        console.log("[CRS] website scan failed:", String((e as any)?.message ?? e));
      }

      scan.meta = {
        ...scan.meta,
        runtime_ms: Date.now() - new Date(scan.created_at).getTime(),
      };

      store.save(scanId, scan);

      const scanInputs = {
        ...(scan as any).inputs,
        hostname,
        website_url: (scan as any).inputs?.website_url,
        sending_email: sending_email ?? "",
        contact_email: contact_email ?? "",
        plan: purchase.sku,
        inbound_test_url: inbound_test_url ?? null,
        recipient_count: recipient_count ?? null,
      };

      const report: StoredReport = {
        ...generateReportV1({ ...scan, inputs: scanInputs } as any),
        payment_status: "paid",
        purchase_id: payload.purchaseId,
        stripe_session_id: purchase.stripe_session_id,
        inputs: scanInputs,
      };

      (report as any).email_auth = (scan as any).email_auth ?? null;
      (report as any).website_scan = (scan as any).website_scan ?? null;
      (report as any).verified_evidence = null;

      // Link scan back to purchase
      updatePurchase(payload.purchaseId, { scan_id: scanId });

      try {
        const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      } catch (err) {
        console.warn("[CRS] failed to write report.json", scanId, String(err));
      }

      reports.set(scanId, report);

      const html = renderReportHtml(report);
      const pdfPath = pdfPathFor(scanId);

      console.log("[CRS] writing pdf:", pdfPath);
      await htmlToPdf(html, pdfPath);

      const exists = fs.existsSync(pdfPath);
      console.log("[CRS] pdf written:", pdfPath, "exists:", exists);

      if (!exists) {
        throw new Error(`PDF generation reported success but file missing: ${pdfPath}`);
      }

      // Inform the user of their inbound test address if verified plan
      const inbound_address = purchase.sku === "verified"
        ? `verify+${scanId}@${process.env.INBOUND_DOMAIN || "inbound.sendshield.nl"}`
        : null;

      sendJson(req, res, 200, { scanId, inbound_address });
    } catch (e) {
      sendJson(req, res, 500, {
        error: "Failed to complete checkout and start scan",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });


  return;
}

// STRIPE WEBHOOK
if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);
    const sig = req.headers["stripe-signature"] as string | undefined;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: import("stripe").Stripe.Event;
    try {
      if (webhookSecret && sig) {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } else {
        // No secret configured (dev) — parse directly
        event = JSON.parse(rawBody.toString()) as import("stripe").Stripe.Event;
      }
    } catch (e) {
      console.warn("[CRS] Stripe webhook parse failed:", String(e));
      sendJson(req, res, 400, { error: "Invalid webhook payload" });
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const purchaseId = session.metadata?.purchaseId;
        if (purchaseId) {
          updatePurchase(purchaseId, {
            status: "paid",
            stripe_session_id: session.id,
            paid_at: new Date().toISOString(),
          });
          console.log("[CRS] Stripe webhook: purchase marked paid:", purchaseId);
        }
      }
      sendJson(req, res, 200, { received: true });
    } catch (e) {
      sendJson(req, res, 500, { error: "Webhook handler failed", detail: String(e) });
    }
  });
  return;
}

// INBOUND EMAIL WEBHOOK — receives parsed email from mail service (Postmark, SendGrid, etc.)
// Extracts verified evidence from headers, patches scan + regenerates PDF.
if (
  req.method === "POST" &&
  url.pathname.startsWith("/api/scan/") &&
  url.pathname.endsWith("/inbound")
) {
  const scanId = url.pathname
    .replace("/api/scan/", "")
    .replace("/inbound", "")
    .trim();

  if (!scanId) {
    sendJson(req, res, 400, { error: "scanId missing" });
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}") as {
        // Generic format
        from?: string;
        to?: string;
        subject?: string;
        message_id?: string;
        received_at?: string;
        authentication_results?: string;
        received?: string;
        headers?: Record<string, string>;
        // Postmark format
        FromFull?: { Email: string; Name?: string };
        To?: string;
        Subject?: string;
        MessageID?: string;
        ReceivedAt?: string;
        Headers?: Array<{ Name: string; Value: string }>;
      };

      // Normalise regardless of sender format
      const from =
        payload.from ?? payload.FromFull?.Email ?? "";
      const to =
        payload.to ?? payload.To ?? "";
      const subject =
        payload.subject ?? payload.Subject ?? "";
      const message_id =
        payload.message_id ?? payload.MessageID ?? "";
      const received_at =
        payload.received_at ?? payload.ReceivedAt ?? new Date().toISOString();

      // Flatten headers from either format
      const flatHeaders: Record<string, string> = {};
      if (payload.headers) {
        for (const [k, v] of Object.entries(payload.headers)) {
          flatHeaders[k.toLowerCase()] = v;
        }
      }
      if (Array.isArray(payload.Headers)) {
        for (const h of payload.Headers) {
          flatHeaders[h.Name.toLowerCase()] = h.Value;
        }
      }

      const rawAuthResults =
        payload.authentication_results ??
        flatHeaders["authentication-results"] ??
        flatHeaders["arc-authentication-results"] ??
        "";

      const rawReceived = payload.received ?? flatHeaders["received"] ?? "";

      // Parse authentication results
      const auth = parseAuthenticationResults(rawAuthResults);

      // Extract TLS info from Received header (e.g. "using TLSv1.3 with cipher ...")
      const tlsVersion = rawReceived.match(/TLSv[\d.]+/i)?.[0];
      const tlsCipher = rawReceived.match(/cipher\s+(\S+)/i)?.[1];

      const verifiedEvidence = {
        received_at,
        from,
        to,
        subject,
        message_id,
        auth,
        tls: tlsVersion ? { version: tlsVersion, cipher: tlsCipher } : undefined,
        raw_authentication_results: rawAuthResults || undefined,
      };

      // Load scan, patch, save
      const scan = store.load(scanId);
      if (!scan) {
        sendJson(req, res, 404, { error: "Scan not found", scanId });
        return;
      }

      (scan as any).verified_evidence = verifiedEvidence;
      store.save(scanId, scan);

      // Patch in-memory report and regenerate PDF
      const existing = reports.get(scanId);
      const reportInputs = existing?.inputs ?? (scan as any).inputs ?? {};

      const updatedReport: StoredReport = {
        ...(existing ?? generateReportV1({ ...scan } as any)),
        ...(existing ? {} : {}),
        inputs: reportInputs,
        payment_status: (existing?.payment_status ?? "paid") as PaymentStatus,
        purchase_id: existing?.purchase_id,
        stripe_session_id: existing?.stripe_session_id,
      };
      (updatedReport as any).email_auth = (scan as any).email_auth ?? null;
      (updatedReport as any).website_scan = (scan as any).website_scan ?? null;
      (updatedReport as any).verified_evidence = verifiedEvidence;

      reports.set(scanId, updatedReport);

      // Persist updated report.json
      try {
        const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(updatedReport, null, 2), "utf-8");
      } catch (err) {
        console.warn("[CRS] failed to write report.json after inbound:", String(err));
      }

      // Regenerate PDF
      try {
        const html = renderReportHtml(updatedReport);
        const pdfPath = pdfPathFor(scanId);
        await htmlToPdf(html, pdfPath);
        console.log("[CRS] PDF regenerated after inbound email:", scanId);
      } catch (e) {
        console.warn("[CRS] PDF regeneration failed:", String(e));
      }

      sendJson(req, res, 200, {
        ok: true,
        scanId,
        auth,
        tls: tlsVersion ? { version: tlsVersion, cipher: tlsCipher } : null,
      });
    } catch (e) {
      sendJson(req, res, 400, {
        error: "Failed to process inbound email",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
  return;
}

// fallback
sendJson(req, res, 404, { error: "Not found" });
}); // <-- sluit createServer callback netjes af


const PORT = Number(process.env.PORT || 8787);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Runner API listening on port ${PORT}`);
});
