import { useEffect, useMemo, useState } from "react";

export default function Hero() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleMediaChange = () => setIsDesktop(mediaQuery.matches);
    handleMediaChange();
    mediaQuery.addEventListener("change", handleMediaChange);
    return () => mediaQuery.removeEventListener("change", handleMediaChange);
  }, []);

  const containerClasses = useMemo(() => {
    return [
      "relative",
      "w-full",
      "overflow-hidden",
      "bg-gradient-to-b",
      "from-slate-950",
      "via-slate-900",
      "to-slate-950",
      isDesktop ? "min-h-screen" : "max-h-[70vh]",
    ].join(" ");
  }, [isDesktop]);

  const contentClasses = useMemo(() => {
    return [
      "mx-auto",
      "flex",
      "h-full",
      "w-full",
      "max-w-6xl",
      "flex-col",
      "justify-center",
      "gap-6",
      "px-4",
      isDesktop ? "py-24" : "py-16",
    ].join(" ");
  }, [isDesktop]);

  return (
    <section id="product" className={containerClasses} aria-labelledby="hero-title">
      <div className={contentClasses}>
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.3em] text-purple-300/80">Campaign Readiness</p>
          <h1
            id="hero-title"
            className="mt-4 text-4xl font-semibold text-white sm:text-5xl lg:text-6xl"
          >
            Confident launches for every email campaign.
          </h1>
          <p className="mt-4 text-base text-slate-300 lg:text-lg">
            {isDesktop
              ? "Combine website stability checks, DNS authentication validation, and inbox verification in one clean report."
              : "One scan. Clear readiness score."
            }
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#scan"
              className="rounded-full bg-purple-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(124,92,255,0.5)] transition hover:bg-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            >
              Start scan
            </a>
            {isDesktop ? (
              <a
                href="#pricing"
                className="rounded-full border border-white/20 px-5 py-3 text-sm text-slate-200 transition hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
              >
                Bekijk pricing
              </a>
            ) : null}
          </div>
        </div>

        {isDesktop ? (
          <div className="mt-12 flex items-center gap-2 text-xs text-slate-400">
            <span>Scroll for pricing ↓</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
