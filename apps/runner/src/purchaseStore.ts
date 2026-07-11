import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.SCAN_STORE_DIR
  ? path.resolve(process.env.SCAN_STORE_DIR)
  : path.resolve(fileURLToPath(import.meta.url), "../../../../data/scans");

const PURCHASES_FILE = path.join(DATA_DIR, "purchases.json");

export type PurchaseStatus = "pending" | "paid" | "failed" | "used";


export type PurchaseRecord = {
  purchaseId: string;
  sku: "basic" | "verified";
  status: PurchaseStatus;
  stripe_session_id?: string;
  hostname?: string;
  sending_email?: string;
  contact_email?: string;
  scanId?: string;
  created_at: string;
};


function loadPurchases(): Map<string, PurchaseRecord> {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(PURCHASES_FILE)) {
      const raw = fs.readFileSync(PURCHASES_FILE, "utf-8");
      const entries = JSON.parse(raw) as [string, PurchaseRecord][];
      return new Map(entries);
    }
  } catch (e) {
    console.warn("[purchaseStore] Failed to load purchases.json:", String(e));
  }
  return new Map();
}

function savePurchases(map: Map<string, PurchaseRecord>) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      PURCHASES_FILE,
      JSON.stringify(Array.from(map.entries()), null, 2),
      "utf-8"
    );
  } catch (e) {
    console.warn("[purchaseStore] Failed to save purchases.json:", String(e));
  }
}

const purchases = loadPurchases();


export function createPurchase(record: PurchaseRecord) {
  purchases.set(record.purchaseId, record);
  savePurchases(purchases);
  return record;
}


export function getPurchase(purchaseId: string) {
  return purchases.get(purchaseId) ?? null;
}


export function updatePurchase(purchaseId: string, patch: Partial<PurchaseRecord>) {
  const existing = purchases.get(purchaseId);
  if (!existing) return null;


  const updated: PurchaseRecord = {
    ...existing,
    ...patch,
  };


  purchases.set(purchaseId, updated);
  savePurchases(purchases);
  return updated;
}


export function listPurchases() {
  return Array.from(purchases.values());
}
