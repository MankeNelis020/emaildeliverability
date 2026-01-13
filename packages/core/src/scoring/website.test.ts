import { describe, expect, it } from "vitest";
import { scoreWebsiteReadiness } from "./website.js";

describe("scoreWebsiteReadiness v1", () => {
  it("LCP > 4s => heavy CWV penalty", () => {
    const r = scoreWebsiteReadiness({
      aggregates: { mobile: { p95: { lcp_ms: 4500 } } }
    });
    expect(r.penalties.cwv).toBeGreaterThanOrEqual(25);
    expect(r.score).toBeLessThan(90);
  });

  it("TTFB > 1800ms => max ttfb penalty", () => {
    const r = scoreWebsiteReadiness({
      aggregates: { mobile: { p95: { ttfb_ms: 2200 } } }
    });
    expect(r.penalties.ttfb).toBe(30);
  });

  it("unstable during send window => stability cap", () => {
    const r = scoreWebsiteReadiness({
      send_window: { enabled: true },
      aggregates: { stability: "unstable", mobile: { p95: { lcp_ms: 2000 } } }
    });
    expect(r.penalties.stability).toBe(20);
  });

  it("variable during send window => penalty 10", () => {
    const r = scoreWebsiteReadiness({
      send_window: { enabled: true },
      aggregates: { stability: "variable", mobile: { p95: { lcp_ms: 2000 } } }
    });
    expect(r.penalties.stability).toBe(10);
  });

  it("blocking penalties sum to max 10", () => {
    const r = scoreWebsiteReadiness({
      aggregates: {
        blockers: {
          render_blocking_js: true,
          consent_blocks_interaction: true,
          excessive_third_parties: true
        }
      }
    });
    expect(r.penalties.blocking).toBe(10);
  });
});

