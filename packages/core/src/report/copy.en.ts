export type Impact = "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

export type ActionId =
  | "dmarc_enforce"
  | "dmarc_add"
  | "dkim_add"
  | "dkim_fix"
  | "spf_add"
  | "spf_fix"
  | "blacklist_cleanup"
  | "redirect_cleanup"
  | "reduce_lcp"
  | "reduce_ttfb"
  | "stabilize_send_window"
  | "reduce_render_blocking"
  | "cache_consistency";

export interface ActionCopy {
  id: ActionId;
  title: string;
  why: string;
  impact: Impact;
  effort: Effort;
  steps: string[];
}

export const ACTIONS: Record<ActionId, ActionCopy> = {
  dmarc_enforce: {
    id: "dmarc_enforce",
    title: "Enforce DMARC (policy=quarantine → reject)",
    why: "Without enforcement, mailbox providers can’t reliably protect your domain from spoofing—and your sending reputation stays fragile.",
    impact: "high",
    effort: "low",
    steps: [
      "Set DMARC policy to quarantine (keep pct=100 if possible).",
      "Monitor DMARC rua reports for 7–14 days and fix misaligned sources.",
      "Move policy to reject once the legitimate sources are stable."
    ]
  },
  dmarc_add: {
    id: "dmarc_add",
    title: "Publish a DMARC record",
    why: "DMARC is the control plane for email authentication. No DMARC means no policy and weak domain protection.",
    impact: "high",
    effort: "low",
    steps: [
      "Start with policy=none and rua reporting enabled.",
      "Confirm all legitimate sources are aligned (SPF/DKIM).",
      "Then move to quarantine/reject."
    ]
  },
  dkim_add: {
    id: "dkim_add",
    title: "Enable DKIM signing for your sending domain",
    why: "DKIM is required for stable inbox placement and for DMARC alignment.",
    impact: "high",
    effort: "medium",
    steps: [
      "Enable DKIM in your ESP (generate selector + DNS records).",
      "Publish the DKIM DNS records and verify they resolve publicly.",
      "Send a test to multiple mailbox providers and confirm DKIM=pass."
    ]
  },
  dkim_fix: {
    id: "dkim_fix",
    title: "Fix DKIM failures and alignment",
    why: "DKIM failures are treated as authentication breakage and can cause spam placement or rejection under DMARC enforcement.",
    impact: "high",
    effort: "medium",
    steps: [
      "Verify the correct DKIM selector is published in DNS.",
      "Confirm the ESP is signing with the same selector/domain.",
      "Check for message modification in transit (forwarders, gateways)."
    ]
  },
  spf_add: {
    id: "spf_add",
    title: "Publish an SPF record for your sending domain",
    why: "SPF helps mailbox providers validate your sending sources and supports DMARC alignment.",
    impact: "medium",
    effort: "low",
    steps: [
      "List only your legitimate sending sources (ESP, CRM, transactional).",
      "End with ~all initially if you’re unsure, then move to -all when stable.",
      "Keep DNS lookups ≤ 10."
    ]
  },
  spf_fix: {
    id: "spf_fix",
    title: "Fix SPF failures and reduce DNS lookups",
    why: "SPF fail/permerror increases spam risk. Excessive DNS lookups can invalidate SPF entirely.",
    impact: "medium",
    effort: "low",
    steps: [
      "Remove obsolete includes and flatten where needed.",
      "Ensure lookups ≤ 10 (includes + redirects + a/mx).",
      "Validate with a known-good SPF checker after changes."
    ]
  },
  blacklist_cleanup: {
    id: "blacklist_cleanup",
    title: "Investigate blacklist listings and remediate",
    why: "Blacklist hits are a direct deliverability blocker—fixing this is priority zero before sending campaigns.",
    impact: "high",
    effort: "high",
    steps: [
      "Identify which IP/domain is listed and why (abuse, open relay, poor list hygiene).",
      "Fix the root cause (authentication, list hygiene, consent, complaint rates).",
      "Request delisting only after remediation and monitoring."
    ]
  },
  redirect_cleanup: {
    id: "redirect_cleanup",
    title: "Remove redirect chains from campaign landing URLs",
    why: "Redirect chains slow down landing page loads and increase the chance of user drop-off during campaigns.",
    impact: "medium",
    effort: "low",
    steps: [
      "Update campaign links to point directly to the final landing page.",
      "Remove intermediate redirects in marketing tracking links.",
      "Ensure the first request returns status 200 instead of multiple 30x redirects."
    ]
  },
  reduce_lcp: {
    id: "reduce_lcp",
    title: "Optimize above-the-fold content to reduce mobile load time",
    why: "Slow mobile LCP reduces conversion and amplifies the impact of a campaign spike.",
    impact: "high",
    effort: "medium",
    steps: [
      "Optimize hero image (size, format, preload) and reduce layout shifts.",
      "Remove/deferr non-critical JS and third-party tags on landing pages.",
      "Use server-side caching/CDN for above-the-fold resources."
    ]
  },
  reduce_ttfb: {
    id: "reduce_ttfb",
    title: "Enable server-side caching or improve origin response time",
    why: "High TTFB means your origin can’t respond fast enough—campaign traffic will amplify the issue.",
    impact: "high",
    effort: "medium",
    steps: [
      "Enable full-page caching or CDN caching for landing pages.",
      "Remove unnecessary redirects or middleware that slow origin responses.",
      "Upgrade hosting resources or move the origin closer to the audience if latency is high."
    ]
  },
  stabilize_send_window: {
    id: "stabilize_send_window",
    title: "Stabilize the website during the send window",
    why: "If the site becomes unstable during send time, you pay for traffic you can’t convert.",
    impact: "high",
    effort: "medium",
    steps: [
      "Run a load test for expected peak traffic around send time.",
      "Scale up critical services (origin, DB, cache) or add queueing/backpressure.",
      "Temporarily reduce heavy scripts and non-essential integrations."
    ]
  },
  reduce_render_blocking: {
    id: "reduce_render_blocking",
    title: "Remove render-blocking scripts on landing pages",
    why: "Render-blocking JS delays first meaningful paint and increases bounce, especially on mobile.",
    impact: "medium",
    effort: "medium",
    steps: [
      "Defer non-critical scripts; load critical CSS first.",
      "Audit tag manager/consent tooling for blocking behavior.",
      "Reduce third-party tags to the minimum required."
    ]
  },
  cache_consistency: {
    id: "cache_consistency",
    title: "Enable CDN caching and verify repeat requests return cache HIT",
    why: "A cache hit rate near 0% means every campaign visitor hits the origin server directly, which risks slowdowns or outages during send spikes.",
    impact: "high",
    effort: "low",
    steps: [
      "Enable CDN caching for static assets and landing pages.",
      "Check cache-control headers and remove cookies that prevent caching.",
      "Confirm repeated requests return cache HIT across multiple locations."
    ]
  },
};

export function headlineFor(verdict: "low" | "medium" | "high", email: number, web: number): string {
  if (verdict === "high") return "High risk: fix authentication and landing-page performance before sending to avoid wasted spend.";
  if (verdict === "medium") return "Moderate risk: address the top blockers before your next send.";
  return email >= 90 && web >= 90
    ? "Low risk: you’re in good shape for the next campaign."
    : "Low risk: a few optimizations can still lift results.";
}


