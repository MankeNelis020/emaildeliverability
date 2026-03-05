import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { startScan } from "../lib/api";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hostname = sessionStorage.getItem("scanHostname");
    if (!hostname) {
      setError("No hostname found. Please start again.");
      return;
    }

    // purchaseId is optional for now (useful later when we add webhook verification)
    const purchaseId = params.get("purchaseId") || sessionStorage.getItem("purchaseId") || "";
    if (purchaseId) sessionStorage.setItem("purchaseId", purchaseId);

    (async () => {
      try {
        const { scanId } = await startScan(hostname);
        sessionStorage.setItem("scanId", scanId);
        navigate(`/result/${scanId}`, { replace: true });
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