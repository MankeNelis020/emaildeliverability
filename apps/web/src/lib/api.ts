export type VerifiedEvidence = {
  received_at: string;
  from: string;
  to: string;
  subject?: string;
  message_id?: string;
  auth: {
    dkim?: { result: string; domain?: string; selector?: string };
    spf?: { result: string; domain?: string; ip?: string };
    dmarc?: { result: string; policy?: string };
  };
  tls?: { version?: string; cipher?: string };
  raw_authentication_results?: string;
};

export type ScanReport = {
  report_version: string;
  generated_at: string;
  scan_id: string;
  headline: string;
  verdict: string;
  confidence: string;
  ready_to_send: boolean;
  blockers: Array<{ id: string; message: string }>;
  warnings?: Array<{ id: string; message: string }>;
  payment_status?: "unpaid" | "freebeta" | "paid";
  inputs?: {
    plan?: "basic" | "verified";
    hostname?: string;
    website_url?: string;
    sending_email?: string;
    contact_email?: string;
    inbound_test_url?: string;
    recipient_count?: number;
  };
  verified_evidence?: VerifiedEvidence | null;
};

export type ScanIntent = {
  plan: "basic" | "verified";
  websiteUrl: string;
  hostname: string;
  sendingEmail: string;
  customerEmail: string;
  recipientCount: number | null;
  inboundTestUrl: string | null;
  createdAt: string;
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const timeoutMs = 60_000; // scans can take up to ~30 s

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Direct scan (FREEBETA / dev). Sends the full scan intent to the backend.
 * Returns scanId.
 */
export async function startScan(intent: ScanIntent): Promise<{ scanId: string }> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostname: intent.hostname,
        sending_email: intent.sendingEmail,
        contact_email: intent.customerEmail,
        plan: intent.plan,
        inbound_test_url: intent.inboundTestUrl,
        recipient_count: intent.recipientCount,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        (data as any)?.error ||
          (data as any)?.detail ||
          `Scan start failed (${response.status})`
      );
    }

    return data as { scanId: string };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error instanceof Error
      ? error
      : new Error("Unable to start scan. Please try again.");
  }
}

export async function getScan(scanId: string): Promise<ScanReport> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/scan/${scanId}`);
    if (!response.ok) {
      throw new Error("Scan not found");
    }
    return (await response.json()) as ScanReport;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please refresh.");
    }
    throw new Error("Unable to load scan report.");
  }
}

/**
 * Creates a Stripe checkout session.
 * Sends scan form data so the backend can store it in the purchase record —
 * /checkout/complete can then use it without the frontend having to re-send everything.
 */
export async function createCheckoutSession(
  sku: "basic" | "verified",
  intent?: ScanIntent
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/checkout/create-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        hostname: intent?.hostname,
        sending_email: intent?.sendingEmail,
        contact_email: intent?.customerEmail,
        inbound_test_url: intent?.inboundTestUrl,
        recipient_count: intent?.recipientCount,
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as any)?.error || "Failed to create checkout session");
  }

  return data as { url: string; purchaseId: string };
}

/**
 * Called on the /checkout/success page after Stripe redirects back.
 * Verifies the payment and starts the scan.
 */
export async function completeCheckoutAndStartScan(params: {
  purchaseId: string;
  intent: ScanIntent;
}): Promise<{ scanId: string; inbound_address?: string | null }> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/checkout/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseId: params.purchaseId,
        hostname: params.intent.hostname,
        sending_email: params.intent.sendingEmail,
        contact_email: params.intent.customerEmail,
        inbound_test_url: params.intent.inboundTestUrl,
        recipient_count: params.intent.recipientCount,
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as any)?.error ||
        (data as any)?.detail ||
        `Failed to complete checkout (${response.status})`
    );
  }

  return data as { scanId: string; inbound_address?: string | null };
}

export { API_BASE };
