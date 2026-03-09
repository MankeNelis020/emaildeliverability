export type PurchaseStatus = "pending" | "paid" | "failed";


export type PurchaseRecord = {
  purchaseId: string;
  sku: "basic" | "verified";
  status: PurchaseStatus;
  stripe_session_id?: string;
  hostname?: string;
  sending_email?: string;
  contact_email?: string;
  created_at: string;
};


const purchases = new Map<string, PurchaseRecord>();


export function createPurchase(record: PurchaseRecord) {
  purchases.set(record.purchaseId, record);
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
  return updated;
}


export function listPurchases() {
  return Array.from(purchases.values());
}
