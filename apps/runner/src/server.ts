// server.ts

import "dotenv/config";
import { createPurchase, getPurchase, updatePurchase } from "./purchaseStore.js";

import { createServer, IncomingMessage } from "node:http";
import { randomUUID, createHmac } from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import { resolveMx } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { scanWebsiteHttp } from "@crs/scanners";
import { scanEmailAuth } from "@crs/scanners";
import { parseMailgunHeaders, buildEmailScanChecks, extractScanIdFromRecipient } from "@crs/scanners";
import Busboy from "busboy";
import Stripe from "stripe";
import { htmlToPdf } from "./pdf.js";


// ✅ Gebruik scanStore zodat inbound later kan updaten
import { createScanStore, generateReportV1 } from "@crs/core";
import { renderReportHtml } from "./pdf/renderReportHtml.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as any,
});


console.log("Stripe key loaded:", !!process.env.STRIPE_SECRET_KEY);


type PaymentStatus = "unpaid" | "paid" | "freebeta" | "free";


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

// Rate limit for free scans: max 3 per apex domain per day
const rateLimit = new Map<string, { count: number; day: string }>();
// Rate limit for free scans: max 5 per IP per day
const rateLimitByIp = new Map<string, { count: number; day: string }>();


function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// Parse multipart/form-data with busboy
function parseMultipart(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const bb = Busboy({ headers: req.headers as any });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file", (_name, stream) => { stream.resume(); }); // drain any file fields
    bb.on("finish", () => resolve(fields));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

// Verify Mailgun HMAC-SHA256 signature
function verifyMailgunSignature(key: string, timestamp: string, token: string, signature: string): boolean {
  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  return expected === signature;
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


// FREE SCAN — no payment, Basic plan only
if (req.method === "POST" && url.pathname === "/api/scan/free") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));

  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}") as {
        hostname?: string;
        sending_email?: string;
        contact_email?: string;
      };

      // Validate required fields
      const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!payload.hostname) {
        sendJson(res, 400, { error: "hostname required" });
        return;
      }
      if (!payload.sending_email || !emailRegex.test(payload.sending_email)) {
        sendJson(res, 400, { error: "sending_email must be a valid email" });
        return;
      }
      if (!payload.contact_email || !emailRegex.test(payload.contact_email)) {
        sendJson(res, 400, { error: "contact_email must be a valid email" });
        return;
      }

      // MX check on contact_email domain (accept if DNS is slow >3s)
      const contactDomain = payload.contact_email.split("@")[1] ?? "";
      const mxResult = await Promise.race([
        resolveMx(contactDomain).catch(() => null as null),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3000)),
      ]);
      if (mxResult !== "timeout" && (!Array.isArray(mxResult) || mxResult.length === 0)) {
        sendJson(res, 400, {
          error: "Contact email domain has no mail server (MX record). Use a real business email.",
        });
        return;
      }

      // Rate limit: max 3 free scans per apex domain per day
      const sendingDomainRaw = payload.sending_email.split("@")[1] ?? payload.hostname;
      const apexDomain = sendingDomainRaw.split(".").slice(-2).join(".");
      const today = new Date().toISOString().slice(0, 10);
      const rl = rateLimit.get(apexDomain);
      if (rl && rl.day === today && rl.count >= 3) {
        sendJson(res, 429, { error: "Max 3 free scans per domain per day." });
        return;
      }
      if (rl && rl.day === today) {
        rl.count++;
      } else {
        rateLimit.set(apexDomain, { count: 1, day: today });
      }

      // Rate limit by IP: max 5 free scans per IP per day
      const clientIp = req.socket.remoteAddress ?? "unknown";
      const ipRl = rateLimitByIp.get(clientIp);
      if (ipRl && ipRl.day === today && ipRl.count >= 5) {
        sendJson(res, 429, { error: "Max 5 free scans per IP per day." });
        return;
      }
      if (ipRl && ipRl.day === today) {
        ipRl.count++;
      } else {
        rateLimitByIp.set(clientIp, { count: 1, day: today });
      }

      const scanId = randomUUID();

      // Create scan
      const scan = makeInitialScan(
        scanId,
        payload.hostname,
        payload.sending_email,
        payload.contact_email
      );
      (scan as any).inputs.plan = "basic";
      store.save(scanId, scan);

      // Email auth
      try {
        const emailAuth = await scanEmailAuth(payload.hostname);
        (scan as any).email_auth = emailAuth;
      } catch (e) {
        console.warn("[CRS] email auth scan failed:", String((e as any)?.message ?? e));
        (scan as any).email_auth = null;
      }
      store.save(scanId, scan);

      // Website scan
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

      // Generate report
      const report: StoredReport = {
        ...generateReportV1({
          ...scan,
          inputs: {
            ...(scan as any).inputs,
            hostname: payload.hostname,
            website_url: (scan as any).inputs?.website_url,
            sending_email: payload.sending_email,
            contact_email: payload.contact_email,
            plan: "basic",
          },
        } as any),
        payment_status: "free",
        inputs: {
          ...(scan as any).inputs,
          hostname: payload.hostname,
          website_url: (scan as any).inputs?.website_url,
          sending_email: payload.sending_email,
          contact_email: payload.contact_email,
          plan: "basic",
        },
      };

      (report as any).email_auth = (scan as any).email_auth ?? null;
      (report as any).website_scan = (scan as any).website_scan ?? null;

      // Store lead
      try {
        const contactApex = contactDomain.split(".").slice(-2).join(".");
        const leadEntry = JSON.stringify({
          email: payload.contact_email,
          domain: contactApex,
          scanId,
          hostname: payload.hostname,
          created_at: new Date().toISOString(),
        });
        fs.mkdirSync(STORE_DIR, { recursive: true });
        fs.appendFileSync(path.join(STORE_DIR, "leads.jsonl"), leadEntry + "\n", "utf-8");
      } catch (e) {
        console.warn("[CRS] failed to write lead:", String(e));
      }

      // Save report to disk
      try {
        const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      } catch (err) {
        console.warn("[CRS] failed to write report.json", scanId, String(err));
      }

      // Cache report in memory (no PDF for free scans)
      reports.set(scanId, report);

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

      // Persist stripe_session_id immediately so /api/checkout/complete can retrieve it
      updatePurchase(purchaseId, { stripe_session_id: session.id });


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


  // "free" and "unpaid" statuses both fail this check intentionally — PDF is for paid/freebeta only
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

if (req.method === "POST" && url.pathname === "/api/checkout/complete") {
  let body = "";
  req.on("data", (chunk) => (body += chunk));


  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}") as {
        purchaseId?: string;
        hostname?: string;
        sending_email?: string;
        contact_email?: string;
      };


      if (!payload.purchaseId) {
        sendJson(res, 400, { error: "purchaseId required" });
        return;
      }


      if (!payload.hostname) {
        sendJson(res, 400, { error: "hostname required" });
        return;
      }


      const purchase = getPurchase(payload.purchaseId);
      if (!purchase) {
        sendJson(res, 404, { error: "Purchase not found" });
        return;
      }

      // Idempotency: if already used, return the existing scanId
      if (purchase.status === "used") {
        if (purchase.scanId) {
          sendJson(res, 200, { scanId: purchase.scanId });
        } else {
          sendJson(res, 409, { error: "This purchase has already been used." });
        }
        return;
      }

      if (!purchase.stripe_session_id) {
        sendJson(res, 400, { error: "Stripe session missing for purchase" });
        return;
      }

      // Verify payment status against Stripe API — never trust client-supplied status
      const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id);


      if (session.payment_status !== "paid") {
        sendJson(res, 402, { error: "Payment not completed" });
        return;
      }


      updatePurchase(payload.purchaseId, { status: "paid" });


      const scanId = randomUUID();


      const scan = makeInitialScan(
        scanId,
        payload.hostname,
        payload.sending_email,
        payload.contact_email
      );


      store.save(scanId, scan);


      try {
        const emailAuth = await scanEmailAuth(payload.hostname);
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


      const report: StoredReport = {
        ...generateReportV1({
          ...scan,
          inputs: {
            ...(scan as any).inputs,
            hostname: payload.hostname,
            website_url: (scan as any).inputs?.website_url,
            sending_email: payload.sending_email ?? "",
            contact_email: payload.contact_email ?? "",
            plan: purchase.sku,
          },
        } as any),


        payment_status: "paid",
        purchase_id: payload.purchaseId,
        stripe_session_id: purchase.stripe_session_id,


        inputs: {
          ...(scan as any).inputs,
          hostname: payload.hostname,
          website_url: (scan as any).inputs?.website_url,
          sending_email: payload.sending_email ?? "",
          contact_email: payload.contact_email ?? "",
          plan: purchase.sku,
        },
      };


      (report as any).email_auth = (scan as any).email_auth ?? null;
      (report as any).website_scan = (scan as any).website_scan ?? null;

      // Verified SKU: set inbound_status and verify_address
      let verifyAddress: string | undefined;
      if (purchase.sku === "verified") {
        verifyAddress = "verify+" + scanId + "@" + (process.env.INBOUND_DOMAIN ?? "inbound.example.com");
        (scan as any).inbound_status = "pending";
        (scan as any).verify_address = verifyAddress;
        store.save(scanId, scan);
        (report as any).inbound_status = "pending";
        (report as any).verify_address = verifyAddress;
      }

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

      // Mark purchase as used so duplicate success-page loads return the same scanId
      updatePurchase(payload.purchaseId, { status: "used", scanId });

      sendJson(res, 200, { scanId, ...(verifyAddress ? { verifyAddress } : {}) });
    } catch (e) {
      sendJson(res, 500, {
        error: "Failed to complete checkout and start scan",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });


  return;
}

// INBOUND EMAIL WEBHOOK (Mailgun)
if (req.method === "POST" && url.pathname === "/api/inbound") {
  (async () => {
    let scanId: string | null = null;
    try {
      const fields = await parseMultipart(req);

      // Signature verification — always return 200 to Mailgun to prevent retries
      const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
      if (signingKey) {
        const { timestamp = "", token = "", signature = "" } = fields;
        if (!verifyMailgunSignature(signingKey, timestamp, token, signature)) {
          console.warn("[CRS] Invalid Mailgun signature — accepting silently");
          sendJson(res, 200, { ok: true, skipped: "invalid_signature" });
          return;
        }
      } else {
        console.warn("[CRS] MAILGUN_WEBHOOK_SIGNING_KEY not set — skipping signature check (dev mode)");
      }

      // Extract scan ID from recipient
      const recipient = fields["recipient"] ?? "";
      const inboundDomain = process.env.INBOUND_DOMAIN ?? "inbound.sendshield.nl";
      scanId = extractScanIdFromRecipient(recipient, inboundDomain);
      if (!scanId) {
        console.warn("[CRS] Could not extract scan ID from recipient:", recipient);
        sendJson(res, 200, { ok: true, skipped: "unknown_recipient" });
        return;
      }

      // Load scan from store
      const scan = store.load<any>(scanId);
      if (!scan) {
        console.warn("[CRS] Scan not found for inbound:", scanId);
        sendJson(res, 200, { ok: true, skipped: "unknown_scan" });
        return;
      }

      // Idempotency: if already received, return 200 without reprocessing
      if (scan.inbound_status === "received") {
        sendJson(res, 200, { ok: true, skipped: "already_received" });
        return;
      }

      // Set timestamps immediately so even parse errors still mark the scan received
      scan.inbound_received_at = new Date().toISOString();
      scan.inbound_status = "received";

      let checks: any;
      let parseError = false;

      try {
        // Parse Mailgun message headers
        const messageHeadersJson = fields["message-headers"] ?? "[]";
        const headers = parseMailgunHeaders(messageHeadersJson);

        // Pass existing DNS DMARC data for alignment mode and policy fallback
        const existingDns = { dmarc: (scan as any).email_auth?.dmarc };

        // Build email_scan checks (async — does DNS lookup for DKIM key bits)
        const fromEmail = fields["from"] ?? fields["sender"] ?? "";
        checks = await buildEmailScanChecks(headers, fromEmail, existingDns);
      } catch (e: any) {
        console.warn("[CRS] Failed to build email scan checks:", String(e?.message ?? e));
        parseError = true;
      }

      // Patch scan
      scan.email_scan = {
        ...(checks ? { checks } : {}),
        inbound_received_at: scan.inbound_received_at,
        ...(parseError ? { parse_error: true } : {}),
      };
      store.save(scanId, scan);

      // Regenerate report
      const existingReport = reports.get(scanId);
      const reportInputs = existingReport?.inputs ?? scan.inputs ?? {};

      const report: StoredReport = {
        ...generateReportV1({
          ...scan,
          inputs: {
            ...reportInputs,
          },
        } as any),
        payment_status: existingReport?.payment_status ?? "paid",
        purchase_id: existingReport?.purchase_id,
        stripe_session_id: existingReport?.stripe_session_id,
        inputs: { ...reportInputs },
      };

      (report as any).email_auth = scan.email_auth ?? null;
      (report as any).website_scan = scan.website_scan ?? null;
      (report as any).email_scan = scan.email_scan;
      (report as any).inbound_status = scan.inbound_status;
      (report as any).inbound_received_at = scan.inbound_received_at;
      (report as any).verify_address = scan.verify_address;

      // Re-render HTML and re-write PDF
      const html = renderReportHtml(report);
      const pdfPath = pdfPathFor(scanId);
      await htmlToPdf(html, pdfPath);

      // Update in-memory reports map
      reports.set(scanId, report);

      // Also update stored report JSON
      try {
        const reportPath = path.join(store.storeDir, `${scanId}.report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      } catch (err) {
        console.warn("[CRS] failed to write report.json after inbound", scanId, String(err));
      }

      sendJson(res, 200, { ok: true, scanId });
    } catch (e: any) {
      console.error("[CRS] Inbound processing error:", String(e?.message ?? e));
      // Always return 200 to prevent Mailgun retries
      sendJson(res, 200, { ok: true, skipped: "processing_error" });
    }
  })();

  return;
}

// fallback
sendJson(res, 404, { error: "Not found" });
}); // <-- sluit createServer callback netjes af


const PORT = Number(process.env.PORT || 8787);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Runner API listening on port ${PORT}`);
});
