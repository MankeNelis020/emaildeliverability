import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startScan, createCheckoutSession, type ScanIntent } from "../lib/api";

function readIntent(): ScanIntent | null {
  try {
    const raw = sessionStorage.getItem("crs_scan_intent_v1");
    return raw ? (JSON.parse(raw) as ScanIntent) : null;
  } catch {
    return null;
  }
}

const ACCESS_CODE = "FREEBETA";

export default function Checkout() {
  const [hostname, setHostname] = useState("");
  const [intent, setIntent] = useState<ScanIntent | null>(null);
  const [code, setCode] = useState("");
  const [sku, setSku] = useState<"basic" | "verified">("basic");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const stored = sessionStorage.getItem("scanHostname");
    if (!stored) {
      navigate("/scan", { replace: true });
      return;
    }
    setHostname(stored);
    const storedIntent = readIntent();
    if (storedIntent) {
      setIntent(storedIntent);
      // Pre-select the plan the user already chose on /scan
      setSku(storedIntent.plan);
    }
  }, [navigate]);

  // FREEBETA flow (direct scan, no payment)
  const handleCheckout = async () => {
    if (code.trim().toUpperCase() !== ACCESS_CODE) {
      setError("Invalid access code. Try FREEBETA.");
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      const fallbackIntent: ScanIntent = intent ?? {
        plan: sku,
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
      navigate(`/result/${scanId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  // Stripe paid flow
  const handlePaidCheckout = async () => {
    setError("");
    setIsLoading(true);
    try {
      // Build intent with possibly updated sku (user may have changed plan on this page)
      const effectiveIntent: ScanIntent = intent
        ? { ...intent, plan: sku }
        : {
            plan: sku,
            websiteUrl: `https://${hostname}`,
            hostname,
            sendingEmail: "",
            customerEmail: "",
            recipientCount: null,
            inboundTestUrl: null,
            createdAt: new Date().toISOString(),
          };

      const { url, purchaseId } = await createCheckoutSession(sku, effectiveIntent);

      sessionStorage.setItem("purchaseId", purchaseId);
      sessionStorage.setItem("scanHostname", hostname);
      // Store effective intent in case plan changed
      sessionStorage.setItem("crs_scan_intent_v1", JSON.stringify(effectiveIntent));

      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setIsLoading(false);
    }
  };

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Checkout</h1>
          <p className="text-sm text-slate-400">Scanning domain: {hostname || "—"}</p>

          {/* --- NEW: Plan selection --- */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">Choose scan</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={sku === "basic" ? "btnPrimary" : "btnSecondary"}
                onClick={() => setSku("basic")}
                disabled={isLoading}
              >
                Basic €10
              </button>
              <button
                type="button"
                className={sku === "verified" ? "btnPrimary" : "btnSecondary"}
                onClick={() => setSku("verified")}
                disabled={isLoading}
              >
                Verified €29
              </button>
            </div>
            <p className="text-xs text-slate-400">
              You’ll be redirected to Stripe to pay securely.
            </p>
          </div>

          <button
            type="button"
            className="btnPrimary w-full"
            onClick={handlePaidCheckout}
            disabled={isLoading}
          >
            {isLoading ? "Redirecting to Stripe..." : "Pay & start scan"}
          </button>

          {/* --- OLD: Access code block stays (with small text change) --- */}
          <div className="border-t border-white/10 pt-6 space-y-3">
            <label className="text-sm font-semibold text-white" htmlFor="access-code">
              Or use an access code
            </label>
            <input
              id="access-code"
              className="inputField"
              placeholder="FREEBETA"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={isLoading}
            />
          </div>

          {error ? <p className="text-xs text-red-300">{error}</p> : null}

          <button
            type="button"
            className="btnSecondary w-full"
            onClick={handleCheckout}
            disabled={isLoading}
          >
            {isLoading ? "Starting scan..." : "Unlock scan"}
          </button>
        </div>
      </div>
    </main>
  );
}