import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer id="contact" className="border-t border-white/10 bg-slate-950/80">
      <div className="container section grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Need help with deliverability?</h3>
          <p className="mt-2 text-sm text-slate-400">Vraag ons team om advies over SPF/DKIM/DMARC of inbox placement.</p>
          <Link to="/contact" className="btnSecondary mt-4">
            Plan advisory call
          </Link>
        </div>
        <div className="card">
          <h4 className="text-sm font-semibold text-white">Contact</h4>
          <p className="mt-3 text-sm text-slate-400">sales@mail-verify.online</p>
          <p className="text-sm text-slate-400">+31 20 000 0000</p>
        </div>
        <div className="card">
          <h4 className="text-sm font-semibold text-white">What you get</h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li>Actionable scan report</li>
            <li>Priority checklist</li>
            <li>Optional verification flow</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
