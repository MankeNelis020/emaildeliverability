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
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Link to="/scan" className="btnPrimary">
              Run again
            </Link>
            <a href="/#pricing" className="btnSecondary">
              Back to pricing
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
