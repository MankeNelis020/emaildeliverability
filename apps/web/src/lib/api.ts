export type ScanReport = {
  report_version: string;
  generated_at: string;
  scan_id: string;
  headline: string;
  verdict: string;
  confidence: string;
  ready_to_send: boolean;
  blockers: Array<{ id: string; message: string; severity?: string }>;
  warnings?: Array<{ id: string; message: string }>;
  payment_status?: "free" | "unpaid" | "paid" | "freebeta";
  inputs?: {
    plan?: string;
    website_url?: string;
    sending_email?: string;
    contact_email?: string;
  };
  scores?: {
    email?: { score: number; status: string };
    website?: { score: number; status: string };
    campaign?: { score: number; level: string };
  };
  top_actions?: Array<{
    id: string;
    title: string;
    why: string;
    impact: string;
    effort: string;
    steps: string[];
  }>;
  why?: string[];
  inbound_status?: "pending" | "received";
  verify_address?: string;
  inbound_received_at?: string;
  email_scan?: {
    checks?: Record<string, unknown>;
    inbound_received_at?: string;
    parse_error?: boolean;
  };
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const timeoutMs = 15000;
// Longer timeout for free scan which runs scans synchronously before returning
const scanTimeoutMs = 60000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit, customTimeoutMs?: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), customTimeoutMs ?? timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function startScan(hostname: string): Promise<{ scanId: string }> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hostname }),
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

export async function startFreeScan(params: {
  hostname: string;
  sending_email: string;
  contact_email: string;
}): Promise<{ scanId: string }> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/scan/free`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      },
      scanTimeoutMs
    );

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

export async function createCheckoutSession(sku: "basic" | "verified") {
  const response = await fetchWithTimeout(`${API_BASE}/api/checkout/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Failed to create checkout session");
  }

  return data as { url: string; purchaseId: string };
}

export async function completeCheckoutAndStartScan(params: {
  purchaseId: string;
  hostname: string;
  sending_email?: string;
  contact_email?: string;
}): Promise<{ scanId: string; verifyAddress?: string }> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/checkout/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
    scanTimeoutMs
  );


  const data = await response.json().catch(() => ({}));


  if (!response.ok) {
    throw new Error(
      (data as any)?.error ||
      (data as any)?.detail ||
      `Failed to complete checkout (${response.status})`
    );
  }


  return data as { scanId: string; verifyAddress?: string };
}

export async function pollScanInboundStatus(
  scanId: string,
  onReceived: (report: ScanReport) => void,
  onTimeout: () => void,
  intervalMs = 5000,
  timeoutMs = 30 * 60 * 1000  // 30 minutes
): Promise<() => void> {
  const start = Date.now();
  let timer: ReturnType<typeof setInterval>;

  const cancel = () => clearInterval(timer);

  timer = setInterval(async () => {
    if (Date.now() - start > timeoutMs) {
      cancel();
      onTimeout();
      return;
    }
    try {
      const report = await getScan(scanId);
      if (report.inbound_status === "received") {
        cancel();
        onReceived(report);
      }
    } catch {
      // Ignore transient errors, keep polling
    }
  }, intervalMs);

  return cancel;
}
