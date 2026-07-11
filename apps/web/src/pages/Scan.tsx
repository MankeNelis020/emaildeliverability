import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeHostname } from "../lib/normalize";
import { startFreeScan } from "../lib/api";

type Plan = "basic" | "verified";

type FieldErrors = {
  websiteUrl?: string;
  sendingEmail?: string;
  customerEmail?: string;
};

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.toString();
  } catch {
    return "";
  }
}

export default function Scan() {
  const [plan, setPlan] = useState<Plan>("basic");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sendingEmail, setSendingEmail] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const isFormValid = useMemo(() => {
    if (!normalizeUrl(websiteUrl)) return false;
    if (!emailRegex.test(sendingEmail.trim())) return false;
    if (!emailRegex.test(customerEmail.trim())) return false;
    return true;
  }, [websiteUrl, sendingEmail, customerEmail]);

  const validate = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!normalizeUrl(websiteUrl)) {
      nextErrors.websiteUrl = "Enter a valid website URL.";
    }
    if (!emailRegex.test(sendingEmail.trim())) {
      nextErrors.sendingEmail = "Enter a valid sending email.";
    }
    if (!emailRegex.test(customerEmail.trim())) {
      nextErrors.customerEmail = "Enter a valid contact email.";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleBasicSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    setError("");
    try {
      const hostname = normalizeHostname(websiteUrl);
      const { scanId } = await startFreeScan({
        hostname,
        sending_email: sendingEmail.trim(),
        contact_email: customerEmail.trim(),
      });
      navigate(`/result/${scanId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setIsSubmitting(false);
    }
  };

  const handleVerifiedContinue = () => {
    if (!validate()) return;
    const hostname = normalizeHostname(websiteUrl);
    sessionStorage.setItem("scanHostname", hostname);
    sessionStorage.setItem("scan_sending_email", sendingEmail.trim());
    sessionStorage.setItem("scan_contact_email", customerEmail.trim());
    sessionStorage.setItem("scan_plan", "verified");
    navigate("/checkout");
  };

  const handleContinue = plan === "basic" ? handleBasicSubmit : handleVerifiedContinue;

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Start scan</h1>

          <div className="scanToggle" role="tablist" aria-label="Scan mode">
            <button
              type="button"
              role="tab"
              aria-selected={plan === "basic"}
              className={`scanToggleButton ${plan === "basic" ? "scanToggleActive" : ""}`}
              onClick={() => setPlan("basic")}
            >
              Basic scan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={plan === "verified"}
              className={`scanToggleButton ${plan === "verified" ? "scanToggleActive" : ""}`}
              onClick={() => setPlan("verified")}
            >
              Verified scan
            </button>
          </div>

          <div className="card space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white" htmlFor="website-url">
                Website URL
              </label>
              <input
                id="website-url"
                className="inputField"
                type="url"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
              />
              {fieldErrors.websiteUrl ? <p className="helperText text-red-300">{fieldErrors.websiteUrl}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-white" htmlFor="sending-email">
                Sending email address
              </label>
              <input
                id="sending-email"
                className="inputField"
                type="email"
                placeholder="marketing@example.com"
                value={sendingEmail}
                onChange={(event) => setSendingEmail(event.target.value)}
              />
              {fieldErrors.sendingEmail ? <p className="helperText text-red-300">{fieldErrors.sendingEmail}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-white" htmlFor="customer-email">
                Contact email address
              </label>
              <input
                id="customer-email"
                className="inputField"
                type="email"
                placeholder="you@yourdomain.com"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
              />
              {fieldErrors.customerEmail ? <p className="helperText text-red-300">{fieldErrors.customerEmail}</p> : null}
            </div>
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            type="button"
            className="btnPrimary w-full"
            onClick={handleContinue}
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting
              ? "Starting scan..."
              : plan === "basic"
              ? "Start gratis scan"
              : "Continue to checkout"}
          </button>
        </div>
      </div>
    </main>
  );
}
