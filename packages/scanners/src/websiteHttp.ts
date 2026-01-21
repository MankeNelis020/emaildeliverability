import { performance } from "node:perf_hooks";


type CacheMode = "no-cache" | "cache";


export type WebsiteHttpScan = {
  aggregates: {
    mobile: { p95: { ttfb_ms: number | null; lcp_ms?: number | null; cls?: number | null; inp_ms?: number | null } };
    desktop: { p95: { ttfb_ms: number | null; lcp_ms?: number | null; cls?: number | null; inp_ms?: number | null } };
    redirects: { count: number };
    stability: "stable" | "unstable" | "unknown";
    cache: {
      consistent_hit: boolean;
      sample_hits: number;
      sample_total: number;
      notes?: string[];
    };
    http: {
      samples: Array<{
        mode: CacheMode;
        url: string;
        status: number | null;
        ok: boolean;
        redirects: number;
        ttfb_ms: number | null;
        cache_hit: boolean | null;
        cache_headers: Record<string, string | null>;
        error?: string;
      }>;
      summary?: {
        overall: { p95: { ttfb_ms: number | null }; stability: string; ok_count: number; total: number };
        no_cache: { p95: { ttfb_ms: number | null }; stability: string; ok_count: number; total: number };
        cache: { p95: { ttfb_ms: number | null }; stability: string; ok_count: number; total: number };
      };
    };
    blockers: {
      render_blocking_js: boolean;
      consent_blocks_interaction: boolean;
      excessive_third_parties: boolean;
    };
  };
};


function p95(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx] ?? null;
}


function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}


function computeStability(ttfbs: number[], okCount: number, total: number): "stable" | "unstable" | "unknown" {
  if (total === 0) return "unknown";
  if (okCount < total) return "unstable";
  if (ttfbs.length < 2) return "unknown";
  const m = median(ttfbs);
  if (m == null) return "unknown";
  const hasSpike = ttfbs.some((v) => v > 2 * m);
  return hasSpike ? "unstable" : "stable";
}


function detectCacheHit(headers: Headers): { hit: boolean | null; snapshot: Record<string, string | null> } {
  const get = (k: string) => headers.get(k);


  const cf = get("cf-cache-status");
  const xCache = get("x-cache");
  const age = get("age");
  const cacheControl = get("cache-control");
  const via = get("via");


  let hit: boolean | null = null;
  if (cf) hit = cf.toUpperCase().includes("HIT");
  else if (xCache) hit = xCache.toUpperCase().includes("HIT");
  else if (age) hit = Number(age) > 0;


  return {
    hit,
    snapshot: {
      "cf-cache-status": cf,
      "x-cache": xCache,
      age: age,
      "cache-control": cacheControl,
      via: via,
    },
  };
}


function withCacheBust(url: string): string {
  const u = new URL(url);
  u.searchParams.set("__crs_cb", `${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return u.toString();
}


async function oneFetch(url: string, mode: CacheMode): Promise<WebsiteHttpScan["aggregates"]["http"]["samples"][number]> {
  const target = mode === "no-cache" ? withCacheBust(url) : url;


  let redirects = 0;
  let currentUrl = target;


  const started = performance.now();


  try {
    for (let i = 0; i < 10; i++) {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers:
          mode === "no-cache"
            ? {
                "cache-control": "no-cache, no-store, must-revalidate",
                pragma: "no-cache",
              }
            : undefined,
      });


      const { hit, snapshot } = detectCacheHit(res.headers);
      const ttfb = performance.now() - started;


      const status = res.status;
      const ok = status >= 200 && status < 400;


      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location");
        redirects++;
        if (!loc) {
          return {
            mode,
            url: currentUrl,
            status,
            ok: false,
            redirects,
            ttfb_ms: Math.round(ttfb),
            cache_hit: hit,
            cache_headers: snapshot,
            error: "Redirect without Location header",
          };
        }
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }


      return {
        mode,
        url: currentUrl,
        status,
        ok,
        redirects,
        ttfb_ms: Math.round(ttfb),
        cache_hit: hit,
        cache_headers: snapshot,
      };
    }


    return {
      mode,
      url: currentUrl,
      status: null,
      ok: false,
      redirects,
      ttfb_ms: null,
      cache_hit: null,
      cache_headers: {},
      error: "Too many redirects",
    };
  } catch (e: any) {
    return {
      mode,
      url: currentUrl,
      status: null,
      ok: false,
      redirects,
      ttfb_ms: null,
      cache_hit: null,
      cache_headers: {},
      error: e?.message ? String(e.message) : "Fetch error",
    };
  }
}


export async function scanWebsiteHttp(
  url: string,
  opts?: { noCacheSamples?: number; cacheSamples?: number }
): Promise<WebsiteHttpScan> {
  const noCacheSamples = opts?.noCacheSamples ?? 3;
  const cacheSamples = opts?.cacheSamples ?? 3;


  const samples: WebsiteHttpScan["aggregates"]["http"]["samples"] = [];


  for (let i = 0; i < noCacheSamples; i++) samples.push(await oneFetch(url, "no-cache"));
  for (let i = 0; i < cacheSamples; i++) samples.push(await oneFetch(url, "cache"));


  const byMode = (mode: CacheMode) => samples.filter((s) => s.mode === mode);


  const okTtfbs = (arr: typeof samples) =>
    arr.filter((s) => s.ok && typeof s.ttfb_ms === "number").map((s) => s.ttfb_ms as number);


  const noCacheArr = byMode("no-cache");
  const cacheArr = byMode("cache");


  const ttfbsNoCache = okTtfbs(noCacheArr);
  const ttfbsCache = okTtfbs(cacheArr);
  const ttfbsAll = okTtfbs(samples);


  const okCountAll = samples.filter((s) => s.ok).length;
  const okCountNoCache = noCacheArr.filter((s) => s.ok).length;
  const okCountCache = cacheArr.filter((s) => s.ok).length;


  const ttfbP95 = p95(ttfbsAll);
  const stability = computeStability(ttfbsAll, okCountAll, samples.length);


  const ttfbP95_noCache = p95(ttfbsNoCache);
  const stability_noCache = computeStability(ttfbsNoCache, okCountNoCache, noCacheArr.length);


  const ttfbP95_cache = p95(ttfbsCache);
  const stability_cache = computeStability(ttfbsCache, okCountCache, cacheArr.length);


  const redirects = Math.max(0, ...samples.map((s) => s.redirects ?? 0));


  const cacheHitKnown = cacheArr.filter((s) => typeof s.cache_hit === "boolean") as Array<
    (typeof cacheArr)[number] & { cache_hit: boolean }
  >;
  const sampleHits = cacheHitKnown.filter((s) => s.cache_hit).length;
  const sampleTotal = cacheHitKnown.length;
  const consistent_hit = sampleTotal > 0 && sampleHits === sampleTotal;


  return {
    aggregates: {
      mobile: { p95: { ttfb_ms: ttfbP95 } },
      desktop: { p95: { ttfb_ms: ttfbP95 } },


      redirects: { count: redirects },
      stability,


      cache: {
        consistent_hit,
        sample_hits: sampleHits,
        sample_total: sampleTotal,
        notes: ["HTTP-only scan (no Lighthouse). Mobile metrics not measured yet."],
      },


      http: {
        samples,
        summary: {
          overall: { p95: { ttfb_ms: ttfbP95 }, stability, ok_count: okCountAll, total: samples.length },
          no_cache: {
            p95: { ttfb_ms: ttfbP95_noCache },
            stability: stability_noCache,
            ok_count: okCountNoCache,
            total: noCacheArr.length,
          },
          cache: {
            p95: { ttfb_ms: ttfbP95_cache },
            stability: stability_cache,
            ok_count: okCountCache,
            total: cacheArr.length,
          },
        },
      },


      blockers: {
        render_blocking_js: false,
        consent_blocks_interaction: false,
        excessive_third_parties: false,
      },
    },
  };
}
