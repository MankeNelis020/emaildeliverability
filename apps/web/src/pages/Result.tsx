import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getScan, type ScanReport } from "../lib/api";

export default function Result() {
  const { scanId } = useParams<{ scanId: string }>();
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadReport = async () => {
      if (!scanId) {
        setError("Scan ID missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await getScan(scanId);
        if (isMounted) {
          setReport(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load report.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadReport();
    return () => {
      isMounted = false;
    };
  }, [scanId]);

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="text-3xl font-semibold text-white">Scan results</h1>
          {loading ? <p className="text-sm text-slate-400">Loading report...</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {report ? (
            <div className="space-y-6">
              <div className="card">
                <p className="text-sm text-slate-400">{report.generated_at}</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{report.headline}</h2>
                <p className="mt-2 text-sm text-slate-300">Verdict: {report.verdict}</p>
                <p className="mt-1 text-sm text-slate-300">
                  Ready to send: <span className="font-semibold">{report.ready_to_send ? "Yes" : "No"}</span>
                </p>
              </div>

              {report.scores ? (
                <div className="card">
                  <h3 className="text-lg font-semibold text-white">Scores</h3>
                  <div className="mt-4 grid grid-cols-3 gap-4">
                    {report.scores.email ? (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Email</p>
                        <p className={`text-2xl font-bold ${report.scores.email.score >= 70 ? "text-green-400" : report.scores.email.score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                          {report.scores.email.score}/100
                        </p>
                        <p className="text-xs text-slate-400">{report.scores.email.status}</p>
                      </div>
                    ) : null}
                    {report.scores.website ? (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Website</p>
                        <p className={`text-2xl font-bold ${report.scores.website.score >= 70 ? "text-green-400" : report.scores.website.score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                          {report.scores.website.score}/100
                        </p>
                        <p className="text-xs text-slate-400">{report.scores.website.status}</p>
                      </div>
                    ) : null}
                    {report.scores.campaign ? (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Campaign</p>
                        <p className={`text-2xl font-bold ${report.scores.campaign.score >= 70 ? "text-green-400" : report.scores.campaign.score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                          {report.scores.campaign.score}/100
                        </p>
                        <p className="text-xs text-slate-400">{report.scores.campaign.level}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="card">
                <h3 className="text-lg font-semibold text-white">Blockers</h3>
                <ul className="mt-4 space-y-2 text-sm text-slate-300">
                  {report.blockers.map((blocker) => (
                    <li key={blocker.id}>
                      <span className="font-semibold">{blocker.id}:</span> {blocker.message}
                    </li>
                  ))}
                </ul>
              </div>

              {report.warnings?.length ? (
                <div className="card">
                  <h3 className="text-lg font-semibold text-white">Warnings</h3>
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    {report.warnings.map((warning) => (
                      <li key={warning.id}>
                        <span className="font-semibold">{warning.id}:</span> {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {report.payment_status === "paid" ? (
                <div className="flex flex-wrap gap-3">
                  {scanId ? (
                    <a
                      href={`https://api.sendshield.nl/api/scan/${scanId}/report.pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btnPrimary"
                    >
                      Download PDF
                    </a>
                  ) : null}
                  <Link to="/scan" className="btnPrimary">
                    Run again
                  </Link>
                  <a href="/#pricing" className="btnSecondary">
                    Back to pricing
                  </a>
                </div>
              ) : (
                <div className="card">
                  <h3 className="text-lg font-semibold text-white">Wil je meer weten?</h3>
                  <p className="mt-2 text-sm text-slate-300">
                    Dit is een gratis Basic scan. Met de Verified scan analyseren we een echte test-mail
                    uit jouw systeem: DKIM-handtekening, SPF-alignment, Return-Path en hoe Microsoft
                    de mail beoordeelt.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link to="/scan" className="btnPrimary">
                      Verified scan starten
                    </Link>
                    <a href="#contact" className="btnSecondary">Plan een gesprek</a>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
