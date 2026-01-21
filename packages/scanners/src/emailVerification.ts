export type ParsedAuth = {
    dkim?: { result: "pass" | "fail" | "none"; domain?: string; selector?: string };
    spf?: { result: "pass" | "fail" | "softfail" | "neutral" | "none"; domain?: string; ip?: string };
    dmarc?: { result: "pass" | "fail" | "none"; policy?: string };
  };
  
  
  export function parseAuthenticationResults(header: string | null | undefined): ParsedAuth {
    const h = String(header ?? "");
    if (!h) return {};
  
  
    const pick = (key: "dkim" | "spf" | "dmarc") => {
      const m = h.match(new RegExp(`${key}=([a-zA-Z]+)`, "i"));
      if (!m) return "none";
      const v = m[1].toLowerCase();
      if (v === "pass") return "pass";
      if (v === "fail") return "fail";
      if (v === "softfail") return "softfail";
      if (v === "neutral") return "neutral";
      return "none";
    };
  
  
    const out: ParsedAuth = {};
  
  
    const dkimRes = pick("dkim");
    out.dkim = { result: dkimRes as any };
    const dkimDomain = h.match(/header\.d=([^\s;]+)/i)?.[1];
    const dkimSel = h.match(/header\.s=([^\s;]+)/i)?.[1];
    if (dkimDomain) out.dkim.domain = dkimDomain;
    if (dkimSel) out.dkim.selector = dkimSel;
  
  
    const spfRes = pick("spf");
    out.spf = { result: spfRes as any };
    const spfIp = h.match(/client-ip=([0-9a-fA-F\.:]+)/i)?.[1];
    if (spfIp) out.spf.ip = spfIp;
  
  
    const dmarcRes = pick("dmarc");
    out.dmarc = { result: dmarcRes as any };
    const pol = h.match(/\bpolicy\.p=(none|quarantine|reject)\b/i)?.[1] ?? h.match(/\bp=([A-Z0-9_-]+)/i)?.[1];
    if (pol) out.dmarc.policy = pol.toLowerCase();
  
  
    return out;
  }
  
  
  export function extractScanIdFromRecipient(recipient: string, inboundDomain: string): string | null {
    const r = recipient.trim().toLowerCase();
    const dom = inboundDomain.trim().toLowerCase();
  
  
    const at = r.lastIndexOf("@");
    if (at < 0) return null;
  
  
    const local = r.slice(0, at);
    const domain = r.slice(at + 1);
  
  
    if (domain !== dom) return null;
    if (!local.startsWith("verify+")) return null;
  
  
    const scanId = local.slice("verify+".length);
    return scanId || null;
  }
  