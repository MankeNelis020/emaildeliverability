import { describe, expect, it } from "vitest";
import { scoreCampaignRisk } from "./campaign-risk.js";

describe("scoreCampaignRisk v1", () => {
  it("DMARC none => hard stop => high", () => {
    const r = scoreCampaignRisk({
      email: {
        score: 95,
        signals: { dmarc_enforced: false, auth_critical: true, blacklisted: false },
        dmarc_present: true,
        dmarc_policy: "none"
      },
      web: {
        score: 95,
        signals: { stability: "stable", send_window_enabled: false, mobile_lcp_p95_ms: 2000, mobile_ttfb_p95_ms: 300 }
      }
    });
    expect(r.level).toBe("high");
    expect(r.hard_stop_applied).toBe(true);
    expect(r.hard_stop_reasons).toContain("dmarc_policy_none");
    expect(r.score).toBeLessThan(60);
  });

  it("blacklisted => hard stop => high", () => {
    const r = scoreCampaignRisk({
      email: {
        score: 90,
        signals: { dmarc_enforced: true, auth_critical: false, blacklisted: true },
        dmarc_present: true,
        dmarc_policy: "reject"
      },
      web: {
        score: 90,
        signals: { stability: "stable", send_window_enabled: false, mobile_lcp_p95_ms: 2500, mobile_ttfb_p95_ms: 400 }
      }
    });
    expect(r.level).toBe("high");
    expect(r.hard_stop_reasons).toContain("blacklisted");
  });

  it("unstable => hard stop => high", () => {
    const r = scoreCampaignRisk({
      email: {
        score: 90,
        signals: { dmarc_enforced: true, auth_critical: false, blacklisted: false },
        dmarc_present: true,
        dmarc_policy: "reject"
      },
      web: {
        score: 80,
        signals: { stability: "unstable", send_window_enabled: true, mobile_lcp_p95_ms: 2000, mobile_ttfb_p95_ms: 500 }
      }
    });
    expect(r.level).toBe("high");
    expect(r.hard_stop_reasons).toContain("website_unstable");
  });

  it("score mapping without hard stop", () => {
    const r = scoreCampaignRisk({
      email: {
        score: 85,
        signals: { dmarc_enforced: true, auth_critical: false, blacklisted: false },
        dmarc_present: true,
        dmarc_policy: "reject"
      },
      web: {
        score: 82,
        signals: { stability: "stable", send_window_enabled: false, mobile_lcp_p95_ms: 2800, mobile_ttfb_p95_ms: 700 }
      }
    });
    // Should be low or medium depending on penalties; but must not be forced high
    expect(r.hard_stop_applied).toBe(false);
    expect(["low", "medium"]).toContain(r.level);
  });

  it("LCP > 4s during send window => hard stop", () => {
    const r = scoreCampaignRisk({
      email: {
        score: 95,
        signals: { dmarc_enforced: true, auth_critical: false, blacklisted: false },
        dmarc_present: true,
        dmarc_policy: "reject"
      },
      web: {
        score: 70,
        signals: { stability: "stable", send_window_enabled: true, mobile_lcp_p95_ms: 4500, mobile_ttfb_p95_ms: 800 }
      }
    });
    expect(r.level).toBe("high");
    expect(r.hard_stop_reasons).toContain("mobile_lcp_gt_4s_during_send_window");
  });
});

