// packages/scanners/src/emailAuth.ts
import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import { toApexDomain, toDmarcHost, toSpfDomain } from "./utils/domain.js";

export type DmarcPolicy = "none" | "quarantine" | "reject" | "unknown";

export type EmailAuthScan = {
  input: {
    raw: string;
    apex_domain: string | null;
    dmarc_host: string | null;
    spf_domain: string | null;
  };
  spf: {
    domain: string | null;
    present: boolean;
    record: string | null;
  };
  dmarc: {
    host: string | null;
    present: boolean;
    record: string | null;
    policy: DmarcPolicy;
    pct: number | null;
  };
};

function flattenTxtRecords(txt: string[][]): string[] {
  return txt.map((chunks) => chunks.join(""));
}

async function resolveTxtFlat(host: string): Promise<string[]> {
  try {
    const raw = await dnsResolveTxt(host);
    return flattenTxtRecords(raw);
  } catch {
    return [];
  }
}

function findSpfRecord(txtRecords: string[]): string | null {
  const hit = txtRecords.find((t) => /^v=spf1\b/i.test(t.trim()));
  return hit ?? null;
}

function findDmarcRecord(txtRecords: string[]): string | null {
  const hit = txtRecords.find((t) => /^v=dmarc1\b/i.test(t.trim()));
  return hit ?? null;
}

function parseDmarcPolicy(record: string | null): DmarcPolicy {
  if (!record) return "unknown";
  const match = record.match(/\bp\s*=\s*(none|quarantine|reject)\b/i);
  if (!match) return "unknown";

  const value = match[1].toLowerCase();
  if (value === "none" || value === "quarantine" || value === "reject") {
    return value;
  }

  return "unknown";
}

function parseDmarcPct(record: string | null): number | null {
  if (!record) return null;
  const match = record.match(/\bpct\s*=\s*(\d{1,3})\b/i);
  if (!match) return 100;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export async function scanEmailAuth(raw: string): Promise<EmailAuthScan> {
  const apex = toApexDomain(raw);

  const spfDomain = apex ? toSpfDomain(apex) : null;
  const dmarcHost = apex ? toDmarcHost(apex) : null;

  let spfRecord: string | null = null;
  if (spfDomain) {
    const txt = await resolveTxtFlat(spfDomain);
    spfRecord = findSpfRecord(txt);
  }

  let dmarcRecord: string | null = null;
  if (dmarcHost) {
    const txt = await resolveTxtFlat(dmarcHost);
    dmarcRecord = findDmarcRecord(txt);
  }

  return {
    input: {
      raw,
      apex_domain:apex,
      dmarc_host: dmarcHost,
      spf_domain: spfDomain,
    },
    spf: {
      domain: spfDomain,
      present: Boolean(spfRecord),
      record: spfRecord,
    },
    dmarc: {
      host: dmarcHost,
      present: Boolean(dmarcRecord),
      record: dmarcRecord,
      policy: parseDmarcPolicy(dmarcRecord),
      pct: parseDmarcPct(dmarcRecord),
    },
  };
}
