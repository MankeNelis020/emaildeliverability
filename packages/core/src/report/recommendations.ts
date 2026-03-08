export type Priority = "High" | "Medium" | "Low";

export interface ActionRecommendation {
  id: string;
  priority: Priority;
  problem: string;
  action: string;
  effort: "Quick fix" | "Requires developer" | "Requires hosting change";
}

export function classifyTTFB(ttfb: number | null) {
  if (ttfb == null) return null;

  if (ttfb < 800) return "good";
  if (ttfb < 1200) return "acceptable";
  return "poor";
}

export function classifyCache(hitRate: number | null) {
  if (hitRate == null) return null;

  if (hitRate > 0.8) return "good";
  if (hitRate > 0.5) return "acceptable";
  return "poor";
}

export function classifyRedirects(count: number) {
  if (count <= 1) return "good";
  if (count <= 3) return "acceptable";
  return "poor";
}

export function websiteRecommendations(report: any): ActionRecommendation[] {
  const recs: ActionRecommendation[] = [];

  const ttfb =
    report?.website_scan?.aggregates?.http?.summary?.no_cache?.p95?.ttfb_ms ?? null;

  const hits = report?.website_scan?.aggregates?.cache?.sample_hits;
  const total = report?.website_scan?.aggregates?.cache?.sample_total;
  const hitRate = total ? hits / total : null;

  const samples =
    report?.website_scan?.aggregates?.http?.samples ??
    report?.website_scan?.http?.samples ??
    [];

  const redirects = Array.isArray(samples)
    ? samples.reduce(
        (acc: number, s: any) => acc + (typeof s?.redirects === "number" ? s.redirects : 0),
        0
      )
    : 0;

  // TTFB
  const ttfbClass = classifyTTFB(ttfb);

  if (ttfbClass === "poor") {
    recs.push({
      id: "ttfb",
      priority: "High",
      problem: `Server response time is slow (${ttfb}ms).`,
      action:
        "Enable server-side caching or upgrade the origin server so landing pages respond faster.",
      effort: "Requires hosting change",
    });
  }

  if (ttfbClass === "acceptable") {
    recs.push({
      id: "ttfb",
      priority: "Medium",
      problem: `Server response time is moderately high (${ttfb}ms).`,
      action:
        "Introduce caching or reduce backend processing time to improve response speed.",
      effort: "Requires developer",
    });
  }

  // CACHE
  const cacheClass = classifyCache(hitRate);

  if (cacheClass === "poor") {
    recs.push({
      id: "cache",
      priority: "High",
      problem: `Cache hit rate is ${Math.round((hitRate ?? 0) * 100)}%.`,
      action:
        "Enable CDN caching for static assets and confirm repeated requests return a cache HIT.",
      effort: "Requires hosting change",
    });
  }

  if (cacheClass === "acceptable") {
    recs.push({
      id: "cache",
      priority: "Medium",
      problem: `Cache hit rate is ${Math.round((hitRate ?? 0) * 100)}%, which is below the preferred benchmark.`,
      action:
        "Review cache headers and CDN settings so repeat requests are served from cache more consistently.",
      effort: "Requires hosting change",
    });
  }

  // REDIRECTS
  const redirectClass = classifyRedirects(redirects);

  if (redirectClass === "poor") {
    recs.push({
      id: "redirects",
      priority: "High",
      problem: `Landing page requires ${redirects} redirects before loading.`,
      action:
        "Update campaign links to point directly to the final landing page URL and remove redirect chains.",
      effort: "Quick fix",
    });
  }

  if (redirectClass === "acceptable") {
    recs.push({
      id: "redirects",
      priority: "Medium",
      problem: `Landing page requires ${redirects} redirects before loading.`,
      action:
        "Reduce redirect hops so campaign traffic reaches the landing page faster.",
      effort: "Quick fix",
    });
  }

  return recs;
}

export function emailRecommendations(report: any): ActionRecommendation[] {
  const recs: ActionRecommendation[] = [];

  const dmarc = report?.email_auth?.dmarc;
  const spf = report?.email_auth?.spf;

  if (!dmarc?.present) {
    recs.push({
      id: "dmarc",
      priority: "High",
      problem: "No DMARC policy is published for the sending domain.",
      action:
        "Publish a DMARC record starting with policy=none and enable aggregate reporting.",
      effort: "Quick fix",
    });
  }

  if (!spf?.present) {
    recs.push({
      id: "spf",
      priority: "Medium",
      problem: "No SPF record detected for the sending domain.",
      action:
        "Add an SPF record listing the legitimate sending infrastructure.",
      effort: "Quick fix",
    });
  }

  return recs;
}

export function buildRecommendations(report: any) {
  const website = websiteRecommendations(report);
  const email = emailRecommendations(report);

  const all = [...website, ...email];

  const priorityOrder = { High: 0, Medium: 1, Low: 2 };

  return all.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
