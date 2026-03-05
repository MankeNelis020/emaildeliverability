import { useNavigate } from "react-router-dom";

export default function CheckoutCancel() {
  const navigate = useNavigate();

  return (
    <main className="section">
      <div className="container">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="card">
            <h1 className="text-2xl font-semibold text-white">Payment cancelled</h1>
            <p className="text-sm text-slate-400">
              No worries — you can try again.
            </p>

            <div className="mt-6 grid gap-3">
              <button className="btnPrimary w-full" onClick={() => navigate("/checkout")}>
                Back to checkout
              </button>
              <button className="btnSecondary w-full" onClick={() => navigate("/scan")}>
                Back to scan
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}