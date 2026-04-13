import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getScan, API_BASE, type ScanReport } from "../lib/api";

function AuthBadge({ result }: { result?: string }) {
  if (!result) return <span className="text-slate-500">—</span>;
  const pass = result === "pass";
  return (
    <span
      className={`font-semibold ${pass ? "text-green-400" : result === "fail" ? "text-red-400" : "text-yellow-400"}`}
    >
      {result.toUpperCase()}
    </span>
  );
}

function VerifiedSection({ report }: { report: ScanReport }) {
  const ev = report.verified_evidence;
  const plan = report.inputs?.plan;

  if (plan !== "verified") return null;

  const inboundAddress = sessionStorage.getItem("crs_inbound_address");

  if (!ev) {
    return (
      <div className="card space-y-3">
        <h3 className="text-lg font-semibold text-white">
          Verified evidence — awaiting test email
        </h3>
        {inboundAddress ? (
          <>
            <p className="text-sm text-slate-300">
              Send a test email from your sending domain to:
            </p>
            <p className="font-mono text-sm bg-slate-800 rounded px-3 py-2 text-white break-all">
              {inboundAddress}
            </p>
            <p className="text-xs text-slate-400">
              Once received, this page will show the full authentication evidence
              (DKIM, SPF, DMARC alignment, TLS).
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No inbound email received yet. Send a test email to your verified
            inbound address to complete verification.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-lg font-semibold text-white">Verified email evidence</h3>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-slate-800 p-3 text-center">
          <div className="text-xs uppercase text-slate-400 mb-1">DKIM</div>
          <AuthBadge result={ev.auth.dkim?.result} />
          {ev.auth.dkim?.domain ? (
            <div className="text-xs text-slate-500 mt-1">{ev.auth.dkim.domain}</div>
          ) : null}
        </div>
        <div className="rounded-lg bg-slate-800 p-3 text-center">
          <div className="text-xs uppercase text-slate-400 mb-1">SPF</div>
          <AuthBadge result={ev.auth.spf?.result} />
        </div>
        <div className="rounded-lg bg-slate-800 p-3 text-center">
          <div className="text-xs uppercase text-slate-400 mb-1">DMARC</div>
          <AuthBadge result={ev.auth.dmarc?.result} />
          {ev.auth.dmarc?.policy ? (
            <div className="text-xs text-slate-500 mt-1">p={ev.auth.dmarc.policy}</div>
          ) : null}
        </div>
      </div>

      <dl className="space-y-1 text-sm text-slate-300">
        <div className="flex gap-2">
          <dt className="font-semibold w-24 shrink-0">From:</dt>
          <dd className="break-all">{ev.from || "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold w-24 shrink-0">Received:</dt>
          <dd>{ev.received_at ? new Date(ev.received_at).toLocaleString() : "—"}</dd>
        </div>
        {ev.tls?.version ? (
          <div className="flex gap-2">
            <dt className="font-semibold w-24 shrink-0">TLS:</dt>
            <dd>
              {ev.tls.version}
              {ev.tls.cipher ? ` / ${ev.tls.cipher}` : ""}
            </dd>
          </div>
        ) : null}
        {ev.message_id ? (
          <div className="flex gap-2">
            <dt className="font-semibold w-24 shrink-0">Message-ID:</dt>
            <dd className="break-all text-xs font-mono">{ev.message_id}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

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
        if (isMounted) setReport(data);
      } catch (err) {
        if (isMounted)
          setError(err instanceof Error ? err.message : "Unable to load report.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadReport();
    return () => {
      isMounted = false;
    };
  }, [scanId]);

  const isPaid =
    report?.payment_status === "paid" || report?.payment_status === "freebeta";

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
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {report.headline}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Verdict: {report.verdict}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Ready to send:{" "}
                  <span className="font-semibold">
                    {report.ready_to_send ? "Yes" : "No"}
                  </span>
                </p>
                {report.inputs?.plan ? (
                  <p className="mt-1 text-xs text-slate-400 capitalize">
                    Plan: {report.inputs.plan}
                  </p>
                ) : null}
              </div>

              {/* Verified evidence section */}
              <VerifiedSection report={report} />

              <div className="card">
                <h3 className="text-lg font-semibold text-white">Blockers</h3>
                <ul className="mt-4 space-y-2 text-sm text-slate-300">
                  {report.blockers.length ? (
                    report.blockers.map((blocker) => (
                      <li key={blocker.id}>
                        <span className="font-semibold">{blocker.id}:</span>{" "}
                        {blocker.message}
                      </li>
                    ))
                  ) : (
                    <li className="text-green-400">No blockers</li>
                  )}
                </ul>
              </div>

              {report.warnings?.length ? (
                <div className="card">
                  <h3 className="text-lg font-semibold text-white">Warnings</h3>
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    {report.warnings.map((warning) => (
                      <li key={warning.id}>
                        <span className="font-semibold">{warning.id}:</span>{" "}
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {scanId && isPaid ? (
              <a
                href={`${API_BASE}/api/scan/${scanId}/report.pdf`}
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
        </div>
      </div>
    </main>
  );
}
