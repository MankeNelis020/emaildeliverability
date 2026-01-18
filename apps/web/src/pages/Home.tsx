import type { ReactNode } from "react";
import { useState } from "react";
import Hero from "../components/Hero";
import Pricing from "../components/Pricing";

type SectionCardProps = {
  id?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

function SectionCard({ id, title, subtitle, actions, children }: SectionCardProps) {
  return (
    <section id={id} className="section">
      <div className="container">
        <div className="card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">{title}</h2>
              {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const faqItems = [
    {
      question: "Moet ik DNS-toegang geven?",
      answer:
        "Nee. De scan start met read-only checks. Alleen als je SPF/DKIM/DMARC echt wilt fixen is DNS-toegang nodig.",
    },
    {
      question: "Slaat de scan data op?",
      answer:
        "We bewaren alleen wat nodig is voor je rapport. TODO: maak dit expliciet als je privacy policy live is.",
    },
    {
      question: "Breekt dit iets op mijn domein?",
      answer: "Nee, de checks zijn read-only en wijzigen niets aan je records of verzendinstellingen.",
    },
    {
      question: "Werkt dit met Cloudflare?",
      answer: "Ja. Je kunt SPF/DKIM/DMARC gewoon beheren in Cloudflare en wij lezen die records uit.",
    },
    {
      question: "Wat als ik meerdere klanten heb?",
      answer: "Je draait scans per klant en kunt rapporten delen of white-labelen (coming soon).",
    },
    {
      question: "Hoe snel krijg ik resultaat?",
      answer: "Meestal binnen 2-4 minuten, inclusief het rapport met prioriteiten.",
    },
    {
      question: "Kunnen jullie ook helpen implementeren?",
      answer: "Ja, via een advisory traject kunnen we verbeteringen samen uitvoeren.",
    },
  ];
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  return (
    <main>
      <Hero />
      <section className="section">
        <div className="container">
          <div className="flex flex-wrap gap-3">
            <a href="/#pricing" className="btnSecondary">
              Bekijk prijzen
            </a>
            <a href="/#agencies" className="btnSecondary">
              Voor agencies
            </a>
            <a href="/#faq" className="btnSecondary">
              FAQ
            </a>
          </div>
        </div>
      </section>
      <Pricing />
      <SectionCard
        title="Waarom teams ons vertrouwen"
        subtitle="Geen loze claims, wel duidelijke deliverability signalen."
      >
        <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">Read-only checks.</div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            Gebaseerd op best practices (SPF/DKIM/DMARC).
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            Duidelijke blockers + next steps.
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            Binnen enkele minuten een deelbaar rapport.
          </div>
        </div>
      </SectionCard>
      <SectionCard
        id="agencies"
        title="Voor agencies die resultaat willen bewijzen"
        subtitle="Maak deliverability meetbaar en voorkom discussies bij iedere campaign launch."
        actions={
          <>
            <a href="/scan" className="btnPrimary">
              Bekijk voorbeeldrapport
            </a>
            <a href="/scan" className="btnSecondary">
              Start agency scan
            </a>
          </>
        }
      >
        <div className="grid gap-4 text-sm text-slate-300 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-white">Minder discussie met klanten</p>
            <p className="mt-2 text-slate-400">Objectief deliverability rapport met duidelijke scores.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-white">Snellere approvals</p>
            <p className="mt-2 text-slate-400">Go/no-go verdict + send-window checks per campagne.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-white">Opschaalbaar voor meerdere klanten</p>
            <p className="mt-2 text-slate-400">White-label / deelbare report link (coming soon).</p>
          </div>
        </div>
      </SectionCard>
      <SectionCard id="faq" title="FAQ" subtitle="De meestgestelde vragen over de scan.">
        <div className="space-y-3">
          {faqItems.map((item, index) => {
            const isOpen = openFaqIndex === index;
            const contentId = `faq-item-${index}`;

            return (
              <div key={item.question} className="rounded-xl border border-white/10 bg-slate-950/40">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-white"
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                >
                  <span>{item.question}</span>
                  <span className="text-slate-400">{isOpen ? "−" : "+"}</span>
                </button>
                <div
                  id={contentId}
                  role="region"
                  aria-hidden={!isOpen}
                  className={`px-4 pb-4 text-sm text-slate-300 ${isOpen ? "block" : "hidden"}`}
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </main>
  );
}
