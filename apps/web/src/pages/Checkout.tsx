import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startScan } from "../lib/api";

const ACCESS_CODE = "FREEBETA";

export default function Checkout() {
  const [hostname, setHostname] = useState("");
  const [code, setCode] = useState("");
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
  }, [navigate]);

  const handleCheckout = async () => {
    if (code.trim().toUpperCase() !== ACCESS_CODE) {
      setError("Invalid access code. Try FREEBETA.");
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      const { scanId } = await startScan(hostname);
      sessionStorage.setItem("scanId", scanId);
      navigate(`/result/${scanId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Checkout</h1>
          <p className="text-sm text-slate-400">Scanning domain: {hostname || "—"}</p>
          <div className="space-y-3">
            <label className="text-sm font-semibold text-white" htmlFor="access-code">
              Access code
            </label>
            <input
              id="access-code"
              className="inputField"
              placeholder="FREEBETA"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            {error ? <p className="text-xs text-red-300">{error}</p> : null}
          </div>
          <button type="button" className="btnPrimary w-full" onClick={handleCheckout} disabled={isLoading}>
            {isLoading ? "Starting scan..." : "Unlock scan"}
          </button>
        </div>
      </div>
    </main>
  );
}
