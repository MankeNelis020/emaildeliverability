import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

type Report = {
  report_version: string;
  generated_at: string;
  scan_id: string;
  headline: string;
  verdict: string;
  confidence: string;
  ready_to_send: boolean;
  blockers: Array<{ id: string; message: string }>;
  warnings?: Array<{ id: string; message: string }>;
};

const reports = new Map<string, Report>();

function buildReport(scanId: string, hostname: string): Report {
  return {
    report_version: "1.0",
    generated_at: new Date().toISOString(),
    scan_id: scanId,
    headline: `Campaign readiness for ${hostname}`,
    verdict: "Needs attention",
    confidence: "medium",
    ready_to_send: false,
    blockers: [
      { id: "DNS-001", message: "SPF record includes 11 DNS lookups." },
      { id: "AUTH-002", message: "DKIM selector missing for marketing domain." },
    ],
    warnings: [{ id: "WEB-010", message: "Homepage cache hit rate below 70%." }],
  };
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function handleOptions(res: import("node:http").ServerResponse) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
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

  const url = new URL(req.url, "http://localhost:8787");

  if (req.method === "POST" && url.pathname === "/api/scan") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as { hostname?: string };
        if (!payload.hostname) {
          sendJson(res, 400, { error: "hostname required" });
          return;
        }
        const scanId = randomUUID();
        const report = buildReport(scanId, payload.hostname);
        reports.set(scanId, report);
        sendJson(res, 200, { scanId });
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/scan/")) {
    const scanId = url.pathname.replace("/api/scan/", "");
    const report = reports.get(scanId);
    if (!report) {
      sendJson(res, 404, { error: "Scan not found" });
      return;
    }
    sendJson(res, 200, report);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(8787, () => {
  console.log("Runner API listening on http://localhost:8787");
});
