import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeCheckoutAndStartScan } from "../lib/api";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hostname = sessionStorage.getItem("scanHostname") || "";
    const purchaseId = params.get("purchaseId") || sessionStorage.getItem("purchaseId") || "";
    const sending_email = sessionStorage.getItem("scan_sending_email") || "";
    const contact_email = sessionStorage.getItem("scan_contact_email") || "";

    if (!hostname || !purchaseId) {
      setError("Missing scan data. Please start again.");
      return;
    }

    if (purchaseId) sessionStorage.setItem("purchaseId", purchaseId);

    (async () => {
      try {
        const { scanId, verifyAddress } = await completeCheckoutAndStartScan({
          purchaseId,
          hostname,
          sending_email,
          contact_email,
        });
        sessionStorage.setItem("scanId", scanId);
        if (verifyAddress) {
          sessionStorage.setItem("verifyAddress", verifyAddress);
          navigate(`/verified-waiting/${scanId}`, { replace: true });
        } else {
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
            {error ? <p className="text-sm text-red-300 mt-3">{error}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
