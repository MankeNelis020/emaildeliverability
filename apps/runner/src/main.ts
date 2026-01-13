import { generateReportV1 } from "@crs/core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ScanResult } from "@crs/core";
import { scoreEmailReadiness, scoreWebsiteReadiness, scoreCampaignRisk } from "@crs/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson<T>(p: string): T {
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as T;
}

function writeJson(p: string, obj: unknown) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

function main() {
  const inputPath = process.argv[2] ?? path.resolve(__dirname, "../src/sample-input.json");
  const outPath = process.argv[3] ?? path.join(process.cwd(), "out.scan-result.json");

  const scan = readJson<ScanResult>(inputPath);

  const email = scoreEmailReadiness(scan.email_scan as any);
  const web = scoreWebsiteReadiness({
    ...(scan.website_scan as any),
    send_window: { enabled: scan.inputs.send_window.enabled }
  });

  // For hard-stops around DMARC we pass the explicit DMARC info if present
  const dmarc = (scan.email_scan as any)?.checks?.dmarc ?? {};
  const dmarc_present = typeof dmarc.present === "boolean" ? dmarc.present : undefined;
  const dmarc_policy = typeof dmarc.policy === "string" ? dmarc.policy : undefined;

  const risk = scoreCampaignRisk({
    email: {
      score: email.score,
      signals: email.signals,
      dmarc_present,
      dmarc_policy
    },
    web: {
      score: web.score,
      signals: web.signals
    }
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

  writeJson(outPath, next);
  console.log(`Wrote: ${outPath}`);
  console.log(`Email: ${email.score} (${email.status})`);
  console.log(`Web:   ${web.score} (${web.status})`);
  console.log(`Risk:  ${risk.level} (${risk.score})`);
}

main();
