import { useEffect, useMemo, useState } from "react";

type NavLink = {
  href: string;
  label: string;
};

const navLinks: NavLink[] = [
  { href: "#product", label: "Product" },
  { href: "#pricing", label: "Pricing" },
  { href: "#agencies", label: "Voor agencies" },
  { href: "#faq", label: "FAQ" },
];

export default function Header() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleMediaChange = () => setIsDesktop(mediaQuery.matches);
    handleMediaChange();
    mediaQuery.addEventListener("change", handleMediaChange);
    return () => mediaQuery.removeEventListener("change", handleMediaChange);
  }, []);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 12);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const headerClasses = useMemo(() => {
    if (isDesktop) {
      return [
        "sticky",
        "top-0",
        "z-50",
        "transition-all",
        "duration-300",
        isScrolled
          ? "backdrop-blur-xl bg-slate-950/70 border-b border-white/10 shadow-lg"
          : "bg-transparent",
      ].join(" ");
    }
    return "sticky top-0 z-50 bg-slate-950/90 border-b border-white/10";
  }, [isDesktop, isScrolled]);

  return (
    <header className={headerClasses}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 lg:py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/20">
            <svg
              aria-hidden
              viewBox="0 0 48 48"
              className="h-5 w-5 text-purple-300"
              fill="currentColor"
            >
              <path d="M24 5 7 14v20l17 9 17-9V14L24 5Zm0 5.2 11.7 6.2-11.7 6.3-11.7-6.3L24 10.2Zm0 26.6-11-5.8V22l11 5.9 11-5.9v9l-11 5.8Z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Campaign Readiness Scan</p>
            <p className="hidden text-xs text-slate-400 lg:block">Email & web performance confidence</p>
          </div>
        </div>

        {isDesktop ? (
          <nav className="hidden items-center gap-6 text-sm text-slate-300 lg:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}

        <div className="flex items-center gap-3">
          {isDesktop ? (
            <a
              href="#contact"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
            >
              Contact
            </a>
          ) : null}
          <a
            href="#scan"
            className="rounded-full bg-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(124,92,255,0.45)] transition hover:bg-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          >
            Start scan
          </a>
        </div>
      </div>
    </header>
  );
}
