import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeCheckoutAndStartScan, getScan, startScan, type ScanIntent } from "../lib/api";

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
  const [scanId, setScanId] = useState<string | null>(null);
  const [inboundAddress, setInboundAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 1: complete checkout / start scan
  useEffect(() => {
    const purchaseId =
      params.get("purchaseId") || sessionStorage.getItem("purchaseId") || "";
    if (purchaseId) sessionStorage.setItem("purchaseId", purchaseId);

    const intent = readIntent();
    const hostname = intent?.hostname || sessionStorage.getItem("scanHostname") || "";
    if (!hostname) {
      setError("No scan details found. Please start again.");
      return;
    }

    (async () => {
      try {
        if (purchaseId && intent) {
          const { scanId: id, inbound_address } = await completeCheckoutAndStartScan({
            purchaseId,
            intent,
          });
          sessionStorage.setItem("scanId", id);

          if (inbound_address) {
            // Verified plan — stay on this page and poll for the test email
            setInboundAddress(inbound_address);
            setScanId(id);
            sessionStorage.setItem("crs_inbound_address", inbound_address);
          } else {
            // Basic plan — go straight to result
            navigate(`/result/${id}`, { replace: true });
          }
        } else {
          // FREEBETA / direct flow
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
          const { scanId: id } = await startScan(fallbackIntent);
          sessionStorage.setItem("scanId", id);
          navigate(`/result/${id}`, { replace: true });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
  }, [navigate, params]);

  // Step 2: poll every 5 s for verified_evidence once we have a scanId + inbound address
  useEffect(() => {
    if (!scanId || !inboundAddress) return;

    pollRef.current = setInterval(async () => {
      try {
        const report = await getScan(scanId);
        if (report.verified_evidence) {
          if (pollRef.current) clearInterval(pollRef.current);
          navigate(`/result/${scanId}`, { replace: true });
        }
      } catch {
        // transient error — keep polling
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scanId, inboundAddress, navigate]);

  function copyAddress() {
    if (!inboundAddress) return;
    navigator.clipboard.writeText(inboundAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Verified waiting screen
  if (inboundAddress && scanId) {
    return (
      <main className="section">
        <div className="container">
          <div className="mx-auto max-w-xl space-y-6">
            <div className="card space-y-5">
              <h1 className="text-2xl font-semibold text-white">Stuur je testmail</h1>
              <p className="text-sm text-slate-300">
                Stuur een e-mail (inhoud maakt niet uit) naar:
              </p>

              <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3">
                <span className="flex-1 font-mono text-sm text-white break-all">
                  {inboundAddress}
                </span>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="shrink-0 rounded bg-slate-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-slate-600"
                >
                  {copied ? "Gekopieerd!" : "Kopieer"}
                </button>
              </div>

              <div className="flex items-center gap-3 text-sm text-slate-400">
                <svg
                  className="h-5 w-5 shrink-0 animate-spin text-slate-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Wachten op jouw testmail…
              </div>

              <p className="text-xs text-slate-500">
                Zodra de testmail is ontvangen, word je automatisch doorgestuurd naar
                je rapport.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Loading / basic plan transition / error state
  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="card">
            <h1 className="text-2xl font-semibold text-white">Payment received</h1>
            <p className="text-sm text-slate-400">Starting your scan…</p>
            {error ? <p className="text-sm text-red-300 mt-3">{error}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
