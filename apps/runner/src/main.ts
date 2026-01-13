import fs from "node:fs";
import path from "node:path";

import type { ScanResult } from "@crs/core";
import {
  scoreEmailReadiness,
  scoreWebsiteReadiness,
  scoreCampaignRisk,
  generateReportV1
} from "@crs/core";

function readJson<T>(p: string): T {
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as T;
}

function writeJson(p: string, obj: unknown) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

function main() {
  // Always resolve outputs to repo root (1 level up from apps/runner)
  const repoRoot = path.resolve(process.cwd(), "..", "..");

  // Allow optional args, default to sample input in src/
  const inputArg = process.argv[2];
  const inputPath = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : path.resolve(process.cwd(), "src", "sample-input.json");

  const outScanPath = path.join(repoRoot, "out.scan-result.json");
  const outReportPath = path.join(repoRoot, "out.report.json");

  const scan = readJson<ScanResult>(inputPath);

  const email = scoreEmailReadiness(scan.email_scan as any);
  const web = scoreWebsiteReadiness({
    ...(scan.website_scan as any),
    send_window: { enabled: scan.inputs.send_window.enabled }
  });

  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarc_present = typeof dmarc.present === "boolean" ? dmarc.present : undefined;
  const dmarc_policy = typeof dmarc.policy === "string" ? dmarc.policy : undefined;

  const risk = scoreCampaignRisk({
    email: { score: email.score, signals: email.signals, dmarc_present, dmarc_policy },
    web: { score: web.score, signals: web.signals }
  });

  const next: ScanResult = {
    ...scan,
    scores: {
      email_readiness: { score: email.score, max: 100 },
      website_readiness: { score: web.score, max: 100 },
      campaign_risk: { level: risk.level, score: risk.score, max: 100 }
    },
    meta: {
      ...scan.meta,
      runtime_ms: scan.meta.runtime_ms || 0
    }
  };

  // Write scan result
  writeJson(outScanPath, next);

  // Write report (based on the scored scan)
  const report = generateReportV1(next);
  writeJson(outReportPath, report);

  console.log(`Input:  ${inputPath}`);
  console.log(`Wrote:  ${outScanPath}`);
  console.log(`Report: ${outReportPath}`);
  console.log(`Email: ${email.score} (${email.status})`);
  console.log(`Web:   ${web.score} (${web.status})`);
  console.log(`Risk:  ${risk.level} (${risk.score})`);
}

main();
