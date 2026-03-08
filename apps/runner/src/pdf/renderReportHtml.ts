// apps/runner/src/pdf/renderReportHtml.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


// sections
import { renderCoverSection } from "./sections/cover.js";
import { renderTocSection } from "./sections/toc.js";
import { renderHowToReadSection } from "./sections/howToRead.js";
import { renderWhatWeScanSection } from "./sections/whatWeScan.js";
import { renderOverviewSection } from "./sections/overview.js";
import { renderAbstractSection } from "./sections/abstract.js";
import { renderWebsiteResultsSection } from "./sections/websiteResults.js";
import { renderEmailResultsSection } from "./sections/emailResults.js";
import { renderConclusionsSection } from "./sections/conclusions.js";
import { renderFooterSection } from "./sections/footer.js";


type AnyReport = Record<string, any>;


// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/**
 * ✅ SINGLE SOURCE OF TRUTH
 * Kies 1 locatie en houd die overal aan.
 *
 * Ik ga hier uit van:
 * apps/runner/src/pdf/styles/reportCSS.css
 */
const CSS_PATH = path.join(__dirname, "styles", "reportCSS.css");


function loadCss(): string {
  try {
    const css = fs.readFileSync(CSS_PATH, "utf-8");
    if (!css.trim()) {
      console.warn("[CRS] CSS loaded but empty:", CSS_PATH);
    } else {
      console.log("[CRS] CSS loaded:", CSS_PATH, "chars:", css.length);
    }
    return css;
  } catch (e) {
    console.warn("[CRS] Could not read CSS file:", CSS_PATH, String(e));
    return "";
  }
}


export function renderReportHtml(report: AnyReport): string {
  const css = loadCss();

  const cover = renderCoverSection(report);
  const toc = renderTocSection(report);
  const howToRead = renderHowToReadSection(report);
  const whatWeScan = renderWhatWeScanSection(report);
  const overview = renderOverviewSection(report);
  const abstract = renderAbstractSection(report);
  const website = renderWebsiteResultsSection(report);
  const email = renderEmailResultsSection(report);
  const conclusions = renderConclusionsSection(report);
  const footer = renderFooterSection(report);


  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Campaign Readiness Report</title>
  <style>
${css}
  </style>
</head>
<body>
  <div class="page">
    ${cover}
    <div class="page-block intro-block">
    ${toc}
    ${howToRead}
    </div>
    ${whatWeScan}
    ${overview}
    ${abstract}
    ${website}
    ${email}
    ${conclusions}
    ${footer}
  </div>
</body>
</html>`;
}
