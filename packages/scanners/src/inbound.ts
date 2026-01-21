// inbound helpers: extract scan token from multiple header fields
export function extractScanTokenFromRecipient(headers: Record<string, string>, inboundDomain: string): string | null {
    const candidates = [
      headers["delivered-to"],
      headers["to"],
      headers["x-original-to"],
      headers["envelope-to"],
      headers["received"],
    ].filter(Boolean) as string[];
  
  
    const joined = candidates.join("\n").toLowerCase();
    const dom = inboundDomain.toLowerCase().replace(".", "\\.");
  
  
    const m = joined.match(new RegExp(`verify\\+([a-z0-9._-]+)@${dom}`, "i"));
    return m?.[1] ?? null;
  }
  