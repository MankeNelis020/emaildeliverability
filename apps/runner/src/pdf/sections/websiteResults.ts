// apps/runner/src/pdf/sections/websiteResults.ts
import { esc } from "../utils/esc.js";
import { fmtMs } from "../utils/fmt.js";

function getSamples(report: any) {
  const samples =
    report?.website_scan?.aggregates?.http?.samples ??
    report?.website_scan?.http?.samples ??
    [];
  return Array.isArray(samples) ? samples : [];
}

function p95(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.floor(0.95 * (sorted.length - 1));
  return sorted[idx] ?? null;
}

function buildTtfbBenchmarkLine(ttfb: number | null): string | null {
  if (typeof ttfb !== "number") return null;

  const benchmark = 1000; // fallback midpoint benchmark
  const deltaPct = Math.round(((ttfb - benchmark) / benchmark) * 100);

  if (ttfb < 800) {
    return `Your no-cache TTFB of ${fmtMs(ttfb)} is in the good range and performs better than the fallback benchmark of ${fmtMs(benchmark)}.`;
  }

  if (ttfb <= 1200) {
    return `Your no-cache TTFB of ${fmtMs(ttfb)} is in the acceptable range and is ${Math.abs(deltaPct)}% ${deltaPct >= 0 ? "above" : "below"} the fallback benchmark of ${fmtMs(benchmark)}.`;
  }

  return `Your no-cache TTFB of ${fmtMs(ttfb)} is ${Math.abs(deltaPct)}% above the fallback benchmark of ${fmtMs(benchmark)} and falls in the poor range.`;
}

function buildCacheBenchmarkLine(cacheHitRate: number | null): string | null {
  if (typeof cacheHitRate !== "number") return null;

  const benchmark = 80;
  const delta = cacheHitRate - benchmark;

  if (cacheHitRate > 80) {
    return `Your cache hit rate of ${cacheHitRate}% is in the good range and ${Math.abs(delta)} percentage points above the fallback benchmark of ${benchmark}%.`;
  }

  if (cacheHitRate >= 50) {
    return `Your cache hit rate of ${cacheHitRate}% is acceptable, but ${Math.abs(delta)} percentage points ${delta >= 0 ? "above" : "below"} the fallback benchmark of ${benchmark}%.`;
  }

  return `Your cache hit rate of ${cacheHitRate}% is below the acceptable range and ${Math.abs(delta)} percentage points below the fallback benchmark of ${benchmark}%.`;
}

function buildRedirectBenchmarkLine(redirects: number | null): string | null {
  if (typeof redirects !== "number") return null;

  const benchmark = 1;
  const delta = redirects - benchmark;

  if (redirects <= 1) {
    return `Your redirect count of ${redirects} is in the good range and aligned with the fallback benchmark of ${benchmark}.`;
  }

  if (redirects <= 3) {
    return `Your redirect count of ${redirects} is acceptable, but ${Math.abs(delta)} above the fallback benchmark of ${benchmark}.`;
  }

  return `Your redirect count of ${redirects} is poor and ${Math.abs(delta)} above the fallback benchmark of ${benchmark}.`;
}

export function renderWebsiteResultsSection(report: any): string {
  const samples = getSamples(report);

  if (!samples.length) {
    return `
      <div class="card section">
        <h2>Website results</h2>
        <div class="meta">No website evidence captured yet.</div>
      </div>
    `;
  }

  const noCache = samples.filter((s: any) => s?.mode === "no-cache");
  const cache = samples.filter((s: any) => s?.mode === "cache");

  const ttfbNoCache = noCache
    .map((s: any) => s?.ttfb_ms)
    .filter((x: any) => typeof x === "number") as number[];

  const ttfbCache = cache
    .map((s: any) => s?.ttfb_ms)
    .filter((x: any) => typeof x === "number") as number[];

  const p95NoCache = p95(ttfbNoCache);
  const p95Cache = p95(ttfbCache);

  const cacheHits = cache
    .map((s: any) => s?.cache_hit)
    .filter((x: any) => typeof x === "boolean") as boolean[];

  const cacheHitCount = cacheHits.filter(Boolean).length;
  const cacheTotal = cacheHits.length;
  const cacheHitRate = cacheTotal ? Math.round((cacheHitCount / cacheTotal) * 100) : null;

  const redirectsTotal = samples.reduce(
    (acc: number, s: any) => acc + (typeof s?.redirects === "number" ? s.redirects : 0),
    0
  );

  const benchmarkLines = [
    buildTtfbBenchmarkLine(p95NoCache),
    buildCacheBenchmarkLine(cacheHitRate),
    buildRedirectBenchmarkLine(redirectsTotal),
  ].filter(Boolean);

  const fmt = (n: any) => (typeof n === "number" ? fmtMs(n) : "—");
  const fmtPct = (n: any) => (typeof n === "number" ? `${n}%` : "—");

  const renderRow = (s: any) => `
  <tr>
    <td class="mono">${esc(s?.status ?? "—")}</td>
    <td class="mono">${esc(s?.redirects ?? 0)}</td>
    <td class="mono">${fmtMs(s?.ttfb_ms)}</td>
    <td>${esc(String(s?.cache_hit ?? "—"))}</td>
    <td class="mono">${esc(s?.cache_headers?.["cf-cache-status"] ?? "—")}</td>
  </tr>
`;

  const renderTable = (rows: any[]) => `
  <table class="table table-compact table-fixed">
    <thead>
      <tr>
        <th style="width:52px;">Status</th>
        <th style="width:72px;">Redirects</th>
        <th style="width:82px;">TTFB</th>
        <th style="width:78px;">Cache hit</th>
        <th style="width:88px;">CF cache</th>
      </tr>
    </thead>
    <tbody>
      ${
        rows.length
          ? rows.map(renderRow).join("")
          : `<tr><td colspan="5" class="meta">No samples</td></tr>`
      }
    </tbody>
  </table>
`;

  return `
    <div class="card section">
      <h2>Website results</h2>
      <div class="meta">HTTP sampling (3× no-cache, 3× cache)</div>

      <div class="summary-strip" style="margin-top:10px;">
        <div class="summary-item">
          <div class="summary-label">P95 TTFB (no-cache)</div>
          <div class="summary-value">${fmt(p95NoCache)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">P95 TTFB (cache)</div>
          <div class="summary-value">${fmt(p95Cache)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Cache hit rate</div>
          <div class="summary-value">${fmtPct(cacheHitRate)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Redirects (total)</div>
          <div class="summary-value">${esc(redirectsTotal)}</div>
        </div>
      </div>

      ${
        benchmarkLines.length
          ? `
        <div class="note" style="margin-top:8px;">
          <b>Benchmark context</b>
          <ul class="list">
            ${benchmarkLines.map((line) => `<li>${esc(line)}</li>`).join("")}
          </ul>
        </div>
      `
          : ""
      }

      <div class="grid two-col" style="margin-top:10px;">
        <div>
          <h2>No-cache samples</h2>
          ${renderTable(noCache)}
        </div>

        <div>
          <h2>Cache samples</h2>
          ${renderTable(cache)}
        </div>
      </div>
    </div>
  `;
}
