import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeCheckoutAndStartScan, startScan, type ScanIntent } from "../lib/api";

function readIntent(): ScanIntent | null {
  try {
    const raw = sessionStorage.getItem("crs_scan_intent_v1");
    return raw ? (JSON.parse(raw) as ScanIntent) : null;
  } catch {
    return null;
  }
}

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [inboundAddress, setInboundAddress] = useState<string | null>(null);

  useEffect(() => {
    const purchaseId =
      params.get("purchaseId") || sessionStorage.getItem("purchaseId") || "";
    if (purchaseId) sessionStorage.setItem("purchaseId", purchaseId);

    const intent = readIntent();

    // Fallback hostname if no full intent stored (e.g. FREEBETA flow)
    const hostname = intent?.hostname || sessionStorage.getItem("scanHostname") || "";
    if (!hostname) {
      setError("No scan details found. Please start again.");
      return;
    }

    (async () => {
      try {
        if (purchaseId && intent) {
          // Paid flow: verify payment with backend then start scan
          const { scanId, inbound_address } = await completeCheckoutAndStartScan({
            purchaseId,
            intent,
          });
          sessionStorage.setItem("scanId", scanId);

          if (inbound_address) {
            setInboundAddress(inbound_address);
            sessionStorage.setItem("crs_inbound_address", inbound_address);
          }

          navigate(`/result/${scanId}`, { replace: true });
        } else {
          // FREEBETA / direct flow — use minimal intent
          const fallbackIntent: ScanIntent = intent ?? {
            plan: "basic",
            websiteUrl: `https://${hostname}`,
            hostname,
            sendingEmail: "",
            customerEmail: "",
            recipientCount: null,
            inboundTestUrl: null,
            createdAt: new Date().toISOString(),
          };
          const { scanId } = await startScan(fallbackIntent);
          sessionStorage.setItem("scanId", scanId);
          navigate(`/result/${scanId}`, { replace: true });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
  }, [navigate, params]);

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="card">
            <h1 className="text-2xl font-semibold text-white">Payment received</h1>
            <p className="text-sm text-slate-400">Starting your scan…</p>
            {inboundAddress ? (
              <p className="text-sm text-slate-300 mt-3">
                Verified scan address:{" "}
                <span className="font-mono font-semibold text-white">
                  {inboundAddress}
                </span>
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-300 mt-3">{error}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
