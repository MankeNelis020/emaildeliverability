import Hero from "../components/Hero";
import Pricing from "../components/Pricing";

export default function Home() {
  return (
    <main>
      <Hero />
      <Pricing />
      <section id="agencies" className="section">
        <div className="container">
          <div className="card">
            <h2 className="text-2xl font-semibold text-white">Voor agencies</h2>
            <p className="mt-2 text-sm text-slate-400">
              Deliverability proof die je eenvoudig kunt delen met klanten en stakeholders.
            </p>
          </div>
        </div>
      </section>
      <section id="faq" className="section">
        <div className="container">
          <div className="card">
            <h2 className="text-2xl font-semibold text-white">FAQ</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>Hoe lang duurt een scan? Meestal 2 tot 4 minuten.</li>
              <li>Heb ik een Verified scan nodig? Alleen als je inbox bewijs nodig hebt.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
