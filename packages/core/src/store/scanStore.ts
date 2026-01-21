import fs from "node:fs";
import path from "node:path";


export type ScanEvent = {
  type: string;
  at: string; // ISO timestamp
  [k: string]: unknown;
};


export type ScanStore = {
  storeDir: string;


  // 1 json per scan in store root
  scanPath: (scanId: string) => string;
  save: (scanId: string, scan: unknown) => void;
  load: <T = any>(scanId: string) => T | null;
  update: <T = any>(scanId: string, patch: unknown) => T;


  // append-only events per scan
  eventsPath: (scanId: string) => string;
  appendEvent: (scanId: string, evt: ScanEvent) => void;


  // simple indexing
  indexByEmail: (email: string, scanId: string) => void;
  indexByDomain: (domain: string, scanId: string) => void;
  findByEmail: (email: string) => string[];
  findByDomain: (domain: string) => string[];
};


export function createScanStore(storeDir: string): ScanStore {
  const dir = path.resolve(storeDir);
  fs.mkdirSync(dir, { recursive: true });


  // indexes live under <storeDir>/_index/...
  const indexDir = path.join(dir, "_index");
  const byEmailDir = path.join(indexDir, "byEmail");
  const byDomainDir = path.join(indexDir, "byDomain");
  fs.mkdirSync(byEmailDir, { recursive: true });
  fs.mkdirSync(byDomainDir, { recursive: true });


  const scanPath = (scanId: string) => path.join(dir, `${scanId}.json`);
  const eventsPath = (scanId: string) => path.join(dir, `${scanId}.events.jsonl`);


  const save = (scanId: string, scan: unknown) => {
    fs.writeFileSync(scanPath(scanId), JSON.stringify(scan, null, 2), "utf-8");
  };


  const load = <T = any>(scanId: string): T | null => {
    const p = scanPath(scanId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  };


  const update = <T = any>(scanId: string, patch: unknown): T => {
    const existing = load<T>(scanId);
    if (!existing) throw new Error(`Scan not found: ${scanId}`);
    const next = deepMerge(existing as any, patch as any) as T;
    save(scanId, next);
    return next;
  };


  const appendEvent = (scanId: string, evt: ScanEvent) => {
    const line = JSON.stringify(evt) + "\n";
    fs.appendFileSync(eventsPath(scanId), line, "utf-8");
  };


  // ---------- indexing ----------
  const safeKey = (s: string) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._@+-]/g, "_");


  const readIndex = (p: string): { scan_ids: string[] } => {
    if (!fs.existsSync(p)) return { scan_ids: [] };
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      return { scan_ids: Array.isArray(data.scan_ids) ? data.scan_ids : [] };
    } catch {
      return { scan_ids: [] };
    }
  };


  const writeIndex = (p: string, scanIds: string[]) => {
    fs.writeFileSync(p, JSON.stringify({ scan_ids: scanIds }, null, 2), "utf-8");
  };


  const indexByEmail = (email: string, scanId: string) => {
    const key = safeKey(email);
    if (!key) return;
    const p = path.join(byEmailDir, `${key}.json`);
    const idx = readIndex(p);
    if (!idx.scan_ids.includes(scanId)) idx.scan_ids.push(scanId);
    writeIndex(p, idx.scan_ids);
  };


  const indexByDomain = (domain: string, scanId: string) => {
    const key = safeKey(domain);
    if (!key) return;
    const p = path.join(byDomainDir, `${key}.json`);
    const idx = readIndex(p);
    if (!idx.scan_ids.includes(scanId)) idx.scan_ids.push(scanId);
    writeIndex(p, idx.scan_ids);
  };


  const findByEmail = (email: string): string[] => {
    const key = safeKey(email);
    if (!key) return [];
    const p = path.join(byEmailDir, `${key}.json`);
    return readIndex(p).scan_ids;
  };


  const findByDomain = (domain: string): string[] => {
    const key = safeKey(domain);
    if (!key) return [];
    const p = path.join(byDomainDir, `${key}.json`);
    return readIndex(p).scan_ids;
  };


  return {
    storeDir: dir,
    scanPath,
    save,
    load,
    update,
    eventsPath,
    appendEvent,
    indexByEmail,
    indexByDomain,
    findByEmail,
    findByDomain,
  };
}


// ---------- helpers ----------
function deepMerge(a: any, b: any): any {
  if (!isObj(a) || !isObj(b)) return b;
  const out: any = { ...a };
  for (const k of Object.keys(b)) {
    if (isObj(a[k]) && isObj(b[k])) out[k] = deepMerge(a[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}


function isObj(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}
