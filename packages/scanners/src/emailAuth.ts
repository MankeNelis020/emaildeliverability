// packages/scanners/src/emailAuth.ts
import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import { toApexDomain, toDmarcHost, toSpfDomain } from "./utils/domain.js";


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
  };
};


function flattenTxtRecords(txt: string[][]): string[] {
  // Elke TXT record kan uit meerdere chunks bestaan -> joinen
  return txt.map((chunks) => chunks.join(""));
}


async function resolveTxtFlat(host: string): Promise<string[]> {
  try {
    const raw = await dnsResolveTxt(host); // ✅ returns string[][]
    return flattenTxtRecords(raw);
  } catch {
    // NXDOMAIN / no data / resolver error -> leeg
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


export async function scanEmailAuth(raw: string): Promise<EmailAuthScan> {
  const apex = toApexDomain(raw);


  const spfDomain = apex ? toSpfDomain(apex) : null;       // meestal apex
  const dmarcHost = apex ? toDmarcHost(apex) : null;       // _dmarc.apex


  // SPF (TXT op apex)
  let spfRecord: string | null = null;
  if (spfDomain) {
    const txt = await resolveTxtFlat(spfDomain);
    spfRecord = findSpfRecord(txt);
  }


  // DMARC (TXT op _dmarc.apex)
  let dmarcRecord: string | null = null;
  if (dmarcHost) {
    const txt = await resolveTxtFlat(dmarcHost);
    dmarcRecord = findDmarcRecord(txt);
  }


  return {
    input: {
      raw,
      apex_domain: apex,
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
    },
  };
}
