// packages/scanners/src/utils/domain.ts


/**
 * Domain/URL normalization utilities
 *
 * Goals:
 * - Website scanners want a fetchable URL (prefer https).
 * - DNS/email auth scanners want a bare domain (no scheme/path/port), typically without www.
 *
 * NOTE:
 * - "True apex" (registrable domain) requires the Public Suffix List.
 *   For now we use a pragmatic approach that works well for common cases (e.g. .nl),
 *   and is safe/predictable (no hidden magic).
 */


export type DomainParseResult = {
    input: string;
    url?: URL;
    host?: string; // lowercase, without port
    hostname?: string; // same as host
    port?: string;
    isIp?: boolean;
  };
  
  
  const DEFAULT_SCHEME = "https:";
  
  
  /** Strip surrounding whitespace, quotes, and trailing dots. */
  function cleanRaw(input: string): string {
    return String(input ?? "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "");
  }
  
  
  /** Very small IP check (IPv4/IPv6-ish). */
  function isIpHost(host: string): boolean {
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    // IPv6 (very loose)
    if (/^[0-9a-f:]+$/i.test(host) && host.includes(":")) return true;
    return false;
  }
  
  
  /**
   * Attempts to parse input into a URL.
   * Accepts:
   * - "example.com"
   * - "https://example.com/path"
   * - "http://www.example.com:8080/..."
   * - "example.com/path"
   *
   * Always returns a URL with a scheme (defaults to https).
   */
  export function parseUrlLike(input: string): DomainParseResult {
    const raw = cleanRaw(input);
    if (!raw) return { input: raw };
  
  
    // If someone pastes "example.com/path", URL() would treat it as a path.
    // So we prefix https:// if no scheme.
    const withScheme =
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `${DEFAULT_SCHEME}//${raw}`;
  
  
    try {
      const url = new URL(withScheme);
      const host = (url.hostname || "").toLowerCase().replace(/\.+$/g, "");
      return {
        input: raw,
        url,
        host,
        hostname: host,
        port: url.port || undefined,
        isIp: host ? isIpHost(host) : undefined,
      };
    } catch {
      // last resort: try to treat as hostname only
      const host = raw
        .split("/")[0]
        .split("?")[0]
        .split("#")[0]
        .toLowerCase()
        .replace(/\.+$/g, "");
  
  
      return {
        input: raw,
        host,
        hostname: host,
        isIp: host ? isIpHost(host) : undefined,
      };
    }
  }
  
  
  /**
   * Normalizes website url for HTTP scanning.
   *
   * - Ensures scheme (https by default)
   * - Lowercases hostname
   * - Keeps path/query by default (because you may want to scan a specific landing page)
   *
   * If you prefer scanning homepage only: set opts.stripPath = true
   */
  export function normalizeWebsiteUrl(
    input: string,
    opts?: { stripPath?: boolean; stripQuery?: boolean; stripHash?: boolean }
  ): string {
    const r = parseUrlLike(input);
    if (!r.url || !r.host) {
      // fallback: if user gave only hostname but parse failed
      const host = (r.host || cleanRaw(input)).toLowerCase();
      return host ? `${DEFAULT_SCHEME}//${host}` : "";
    }
  
  
    const u = new URL(r.url.toString());
    u.protocol = u.protocol || DEFAULT_SCHEME;
    u.hostname = r.host; // already lowercased
  
  
    if (opts?.stripPath) u.pathname = "/";
    if (opts?.stripQuery) u.search = "";
    if (opts?.stripHash) u.hash = "";
  
  
    // Ensure at least "/"
    if (!u.pathname) u.pathname = "/";
  
  
    return u.toString();
  }
  
  
  /**
   * Returns the domain to use for DNS lookups (SPF/DMARC).
   *
   * - Removes scheme, path, port
   * - Lowercases
   * - Removes leading "www."
   *
   * This returns "domain-ish" (host), NOT a guaranteed PSL-registrable domain.
   * For most business domains (.nl, .com) this is exactly what you want.
   */
  export function toApexDomain(input: string): string | null {
    const r = parseUrlLike(input);
    let host = (r.host || "").toLowerCase();
    if (!host) return "";
  
  
    // drop brackets around IPv6 if ever present
    host = host.replace(/^\[|\]$/g, "");
  
  
    // remove common prefix
    if (host.startsWith("www.")) host = host.slice(4);
  
  
    // remove trailing dot(s)
    host = host.replace(/\.+$/g, "");
  
  
    return host;
  }
  
  
  /** DMARC record lives on _dmarc.<domain> */
  export function toDmarcHost(domainOrUrl: string): string | null {
    const d = toApexDomain(domainOrUrl);
    return d ? `_dmarc.${d}` : "";
  }
  
  
  /**
   * SPF is stored as TXT on the root domain typically.
   * We keep it explicit (helps later if you want subdomain SPF).
   */
  export function toSpfDomain(domainOrUrl: string): string | null {
    return toApexDomain(domainOrUrl);
  }
  

