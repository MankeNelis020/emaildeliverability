import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeHostname } from "../lib/normalize";

export default function Scan() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleContinue = () => {
    const normalized = normalizeHostname(value);
    if (!normalized) {
      setError("Enter a valid domain or URL.");
      return;
    }
    sessionStorage.setItem("scanHostname", normalized);
    setError("");
    navigate("/checkout");
  };

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Start a scan</h1>
          <p className="text-sm text-slate-400">
            Enter your domain or website URL. We will normalize it automatically.
          </p>
          <div className="space-y-3">
            <label className="text-sm font-semibold text-white" htmlFor="domain">
              Domain or URL
            </label>
            <input
              id="domain"
              className="inputField"
              placeholder="example.com"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {error ? <p className="text-xs text-red-300">{error}</p> : null}
          </div>
          <button type="button" className="btnPrimary w-full" onClick={handleContinue}>
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
