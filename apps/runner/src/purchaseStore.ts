import fs from "node:fs";
import path from "node:path";

export type PurchaseStatus = "pending" | "paid" | "failed";

export type PurchaseRecord = {
  purchaseId: string;
  sku: "basic" | "verified";
  status: PurchaseStatus;
  stripe_session_id?: string;
  hostname?: string;
  sending_email?: string;
  contact_email?: string;
  inbound_test_url?: string;
  recipient_count?: number;
  scan_id?: string;        // set once the scan is created after payment
  created_at: string;
  paid_at?: string;
};

let purchaseDir: string | null = null;
const purchases = new Map<string, PurchaseRecord>();

/**
 * Call once at startup to set the directory for persistent storage and
 * preload any records that were written in earlier runs.
 */
export function initPurchaseStore(dir: string) {
  purchaseDir = path.resolve(dir);
  fs.mkdirSync(purchaseDir, { recursive: true });

  try {
    const files = fs
      .readdirSync(purchaseDir)
      .filter((f) => f.endsWith(".purchase.json"));
    for (const f of files) {
      try {
        const record = JSON.parse(
          fs.readFileSync(path.join(purchaseDir, f), "utf-8")
        ) as PurchaseRecord;
        purchases.set(record.purchaseId, record);
      } catch {
        // corrupt file — skip
      }
    }
    console.log(
      `[CRS] Purchase store loaded ${files.length} record(s) from ${purchaseDir}`
    );
  } catch (e) {
    console.warn("[CRS] Could not preload purchase store:", String(e));
  }
}

function purchasePath(purchaseId: string): string {
  return path.join(purchaseDir!, `${purchaseId}.purchase.json`);
}

function saveToDisk(record: PurchaseRecord) {
  if (!purchaseDir) return;
  try {
    fs.writeFileSync(purchasePath(record.purchaseId), JSON.stringify(record, null, 2), "utf-8");
  } catch (e) {
    console.warn("[CRS] Failed to persist purchase:", record.purchaseId, String(e));
  }
}

export function createPurchase(record: PurchaseRecord): PurchaseRecord {
  purchases.set(record.purchaseId, record);
  saveToDisk(record);
  return record;
}

export function getPurchase(purchaseId: string): PurchaseRecord | null {
  if (purchases.has(purchaseId)) return purchases.get(purchaseId)!;

  // fall back to disk (e.g. after server restart)
  if (purchaseDir) {
    const p = purchasePath(purchaseId);
    if (fs.existsSync(p)) {
      try {
        const record = JSON.parse(fs.readFileSync(p, "utf-8")) as PurchaseRecord;
        purchases.set(purchaseId, record);
        return record;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function updatePurchase(
  purchaseId: string,
  patch: Partial<PurchaseRecord>
): PurchaseRecord | null {
  const existing = getPurchase(purchaseId);
  if (!existing) return null;

  const updated: PurchaseRecord = { ...existing, ...patch };
  purchases.set(purchaseId, updated);
  saveToDisk(updated);
  return updated;
}

export function listPurchases(): PurchaseRecord[] {
  return Array.from(purchases.values());
}
