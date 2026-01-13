import { describe, expect, it } from "vitest";
import { scoreEmailReadiness } from "./email.js";

describe("scoreEmailReadiness v1", () => {
  it("DMARC missing => heavy penalty and high risk signal", () => {
    const r = scoreEmailReadiness({ checks: { dmarc: { present: false } } });
    expect(r.score).toBeLessThan(80);
    expect(r.signals.dmarc_enforced).toBe(false);
    expect(r.signals.auth_critical).toBe(true);
  });

  it("DMARC policy none => penalty", () => {
    const r = scoreEmailReadiness({
      checks: { dmarc: { present: true, policy: "none", pct: 100 } }
    });
    expect(r.score).toBeLessThan(90);
    expect(r.signals.auth_critical).toBe(true);
  });

  it("DKIM missing => -20", () => {
    const r = scoreEmailReadiness({
      checks: { dkim: { present: false }, dmarc: { present: true, policy: "reject", pct: 100 } }
    });
    expect(r.penalties.dkim).toBe(20);
  });

  it("SPF permerror => -15", () => {
    const r = scoreEmailReadiness({
      checks: {
        spf: { present: true, result: "permerror" },
        dmarc: { present: true, policy: "reject", pct: 100 },
        dkim: { present: true, result: "pass" }
      }
    });
    expect(r.penalties.spf).toBe(15);
    expect(r.signals.auth_critical).toBe(true);
  });

  it("Blacklist hit => -30 and blacklisted signal true", () => {
    const r = scoreEmailReadiness({
      checks: {
        blacklists: { listed: true, hits: [{ list: "example", evidence: "hit" }] },
        dmarc: { present: true, policy: "reject", pct: 100 },
        dkim: { present: true, result: "pass" },
        spf: { present: true, result: "pass" }
      }
    });
    expect(r.penalties.reputation).toBe(30);
    expect(r.signals.blacklisted).toBe(true);
  });

  it("Bonus capped at 5", () => {
    const r = scoreEmailReadiness({
      checks: {
        dmarc: { present: true, policy: "reject", pct: 100, alignment_mode: "strict" },
        dkim: { present: true, result: "pass", selectors_checked: ["a", "b"] },
        mta_sts: { present: true, policy_mode: "enforce" },
        tlsrpt: { present: true },
        bimi: { present: true },
        spf: { present: true, result: "pass" }
      }
    });
    expect(r.bonus_applied).toBe(5);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

