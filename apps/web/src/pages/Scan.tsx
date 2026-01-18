import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeHostname } from "../lib/normalize";

type Plan = "basic" | "verified";

type Errors = {
  websiteUrl?: string;
  sendingEmail?: string;
  customerEmail?: string;
  recipientCount?: string;
  inboundTestUrl?: string;
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
  const [recipientCount, setRecipientCount] = useState("");
  const [inboundTestUrl, setInboundTestUrl] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const isVerified = plan === "verified";

  const isFormValid = useMemo(() => {
    if (!normalizeUrl(websiteUrl)) return false;
    if (!emailRegex.test(sendingEmail.trim())) return false;
    if (!emailRegex.test(customerEmail.trim())) return false;
    if (isVerified) {
      const count = Number(recipientCount);
      if (!Number.isInteger(count) || count < 1) return false;
      if (!normalizeUrl(inboundTestUrl)) return false;
    }
    return true;
  }, [websiteUrl, sendingEmail, customerEmail, recipientCount, inboundTestUrl, isVerified]);

  const handlePlanChange = (nextPlan: Plan) => {
    setPlan(nextPlan);
    if (nextPlan === "basic") {
      setRecipientCount("");
      setInboundTestUrl("");
      setErrors((prev) => ({
        ...prev,
        recipientCount: undefined,
        inboundTestUrl: undefined,
      }));
    }
  };

  const validate = (): boolean => {
    const nextErrors: Errors = {};
    const normalizedUrl = normalizeUrl(websiteUrl);
    if (!normalizedUrl) {
      nextErrors.websiteUrl = "Enter a valid website URL.";
    }
    if (!emailRegex.test(sendingEmail.trim())) {
      nextErrors.sendingEmail = "Enter a valid sending email.";
    }
    if (!emailRegex.test(customerEmail.trim())) {
      nextErrors.customerEmail = "Enter a valid customer email.";
    }
    if (isVerified) {
      const count = Number(recipientCount);
      if (!Number.isInteger(count) || count < 1) {
        nextErrors.recipientCount = "Recipient count must be at least 1.";
      }
      if (!normalizeUrl(inboundTestUrl)) {
        nextErrors.inboundTestUrl = "Enter a valid inbound test URL.";
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleContinue = () => {
    if (!validate()) {
      return;
    }
    setIsSubmitting(true);
    const normalizedUrl = normalizeUrl(websiteUrl);
    const hostname = normalizeHostname(websiteUrl);
    const payload = {
      plan,
      websiteUrl: normalizedUrl,
      hostname,
      sendingEmail: sendingEmail.trim(),
      customerEmail: customerEmail.trim(),
      recipientCount: isVerified ? Number(recipientCount) : null,
      inboundTestUrl: isVerified ? normalizeUrl(inboundTestUrl) : null,
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem("crs_scan_intent_v1", JSON.stringify(payload));
    sessionStorage.setItem("scanHostname", hostname);
    navigate("/checkout");
  };

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
              onClick={() => handlePlanChange("basic")}
            >
              Basic scan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={plan === "verified"}
              className={`scanToggleButton ${plan === "verified" ? "scanToggleActive" : ""}`}
              onClick={() => handlePlanChange("verified")}
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
              {errors.websiteUrl ? <p className="helperText text-red-300">{errors.websiteUrl}</p> : null}
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
              {errors.sendingEmail ? <p className="helperText text-red-300">{errors.sendingEmail}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-white" htmlFor="customer-email">
                Customer email address
              </label>
              <input
                id="customer-email"
                className="inputField"
                type="email"
                placeholder="you@customer.com"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
              />
              {errors.customerEmail ? <p className="helperText text-red-300">{errors.customerEmail}</p> : null}
            </div>

            {isVerified ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white" htmlFor="recipient-count">
                    Approx. recipients
                  </label>
                  <input
                    id="recipient-count"
                    className="inputField"
                    type="number"
                    min={1}
                    placeholder="10000"
                    value={recipientCount}
                    onChange={(event) => setRecipientCount(event.target.value)}
                  />
                  {errors.recipientCount ? <p className="helperText text-red-300">{errors.recipientCount}</p> : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white" htmlFor="inbound-url">
                    Unique inbound test URL
                  </label>
                  <input
                    id="inbound-url"
                    className="inputField"
                    type="url"
                    placeholder="https://verify.example.com"
                    value={inboundTestUrl}
                    onChange={(event) => setInboundTestUrl(event.target.value)}
                  />
                  <p className="helperText">Send a test email to this unique address after checkout.</p>
                  {errors.inboundTestUrl ? <p className="helperText text-red-300">{errors.inboundTestUrl}</p> : null}
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            className="btnPrimary w-full"
            onClick={handleContinue}
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </div>
      </div>
    </main>
  );
}
