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
};

const baseURL = "http://localhost:8787";
const timeoutMs = 15000;

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

export async function startScan(hostname: string): Promise<{ scanId: string }> {
  try {
    const response = await fetchWithTimeout(`${baseURL}/api/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hostname }),
    });

    if (!response.ok) {
      throw new Error("Scan start failed");
    }

    return (await response.json()) as { scanId: string };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw new Error("Unable to start scan. Please try again.");
  }
}

export async function getScan(scanId: string): Promise<ScanReport> {
  try {
    const response = await fetchWithTimeout(`${baseURL}/api/scan/${scanId}`);
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
