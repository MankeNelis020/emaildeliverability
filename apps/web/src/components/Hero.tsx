import { Link } from "react-router-dom";

export default function Hero() {
  return (
    <section id="product" className="section">
      <div className="container">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-purple-300/80">Campaign Readiness</p>
            <h1 className="mt-4 text-4xl font-semibold text-white sm:text-5xl">
              Confident launches for every email campaign.
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-300">
              Combine website stability checks, DNS authentication validation, and inbox verification in one clean report.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/scan" className="btnPrimary">
                Start scan
              </Link>
              <a href="/#pricing" className="btnSecondary">
                Bekijk pricing
              </a>
            </div>
          </div>
          <div className="card">
            <p className="text-sm font-semibold text-white">What you get</p>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li>Website stability checks with cache + no-cache sampling.</li>
              <li>SPF, DKIM, and DMARC coverage in one place.</li>
              <li>Optional verified inbox evidence for stakeholders.</li>
            </ul>
            <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-400">
              Average scan time: 2-4 minutes.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
