import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pollScanInboundStatus } from "../lib/api";

type Status = "waiting" | "received" | "timeout";

export default function VerifiedWaiting() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("waiting");
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const verifyAddress =
    sessionStorage.getItem("verifyAddress") ||
    (scanId ? `verify+${scanId}@inbound.sendshield.nl` : "—");

  useEffect(() => {
    if (!scanId) return;

    pollScanInboundStatus(
      scanId,
      () => {
        setStatus("received");
        setTimeout(() => navigate(`/result/${scanId}`, { replace: true }), 1500);
      },
      () => setStatus("timeout")
    ).then((cancel) => {
      cancelRef.current = cancel;
    });

    return () => cancelRef.current?.();
  }, [scanId, navigate]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(verifyAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Stuur je testmail</h1>

          {status === "waiting" && (
            <>
              <div className="card space-y-4">
                <p className="text-sm text-slate-300">
                  Stuur één testmail vanuit jouw <strong>nieuwsbriefsysteem</strong> (bijv. Mailchimp,
                  ActiveCampaign, Laposta) naar onderstaand adres. Gebruik niet je persoonlijke
                  e-mailclient — we meten de headers van je verzendsysteem, niet van Gmail of Outlook.
                </p>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white">Stuur naar dit adres:</label>
                  <div className="flex gap-2">
                    <code className="inputField flex-1 font-mono text-sm select-all">
                      {verifyAddress}
                    </code>
                    <button type="button" className="btnSecondary" onClick={copyAddress}>
                      {copied ? "Gekopieerd!" : "Kopieer"}
                    </button>
                  </div>
                </div>

                <div className="text-sm text-slate-400 space-y-1">
                  <p>• Gebruik het e-mailadres waarmee je normaal verstuurt</p>
                  <p>• Onderwerp en inhoud mogen leeg zijn, of stuur een echte campagnemail</p>
                  <p>• Wacht na het verzenden — we verwerken de mail automatisch (seconden tot minuten)</p>
                </div>
              </div>

              <div className="card flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p className="text-sm text-slate-400">Wachten op testmail…</p>
              </div>
            </>
          )}

          {status === "received" && (
            <div className="card">
              <p className="text-green-400 font-semibold">✓ Testmail ontvangen — rapport wordt geladen…</p>
            </div>
          )}

          {status === "timeout" && (
            <div className="card space-y-4">
              <p className="text-yellow-400 font-semibold">Geen mail ontvangen binnen 30 minuten</p>
              <p className="text-sm text-slate-300">
                Het kan zijn dat de mail vertraagd is of niet is aangekomen. Het adres blijft actief —
                stuur de testmail alsnog en herlaad deze pagina om te controleren of de scan compleet is.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btnPrimary"
                  onClick={() => window.location.reload()}
                >
                  Opnieuw controleren
                </button>
                <a href={`/result/${scanId}`} className="btnSecondary">
                  Bekijk rapport (zonder Verified data)
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
