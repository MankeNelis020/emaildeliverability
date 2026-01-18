import { Link } from "react-router-dom";

export default function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-semibold text-white">Pricing</h2>
            <p className="mt-2 text-sm text-slate-400">Transparant, zonder poespas. Kies het detailniveau dat bij je past.</p>
          </div>
          <Link to="/scan" className="btnPrimary">
            Start scan
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card">
            <h3 className="text-lg font-semibold text-white">Basic scan</h3>
            <p className="mt-2 text-3xl font-semibold text-white">€10</p>
            <p className="mt-2 text-sm text-slate-400">Standaard DNS checks + website health.</p>
          </div>
          <div className="card border border-purple-500/40">
            <h3 className="text-lg font-semibold text-white">Verified scan</h3>
            <p className="mt-2 text-3xl font-semibold text-white">€30</p>
            <p className="mt-2 text-sm text-slate-400">Inbound test + auth results parsing.</p>
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold text-white">Professional advisory</h3>
            <p className="mt-2 text-3xl font-semibold text-white">€100 / p.h.</p>
            <p className="mt-2 text-sm text-slate-400">Hands-on implementatie en deliverability strategie.</p>
            <Link to="/contact" className="btnSecondary mt-4">
              Get enquiry
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
