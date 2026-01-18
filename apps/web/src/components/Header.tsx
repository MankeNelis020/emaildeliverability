import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

const navItems = [
  { label: "Product", href: "/#product" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Voor agencies", href: "/#agencies" },
  { label: "FAQ", href: "/#faq" },
];

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b border-white/10 transition ${
        isScrolled ? "backdrop-blur-xl bg-slate-950/70" : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between py-4">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/20">
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
            <p className="hidden text-xs text-slate-400 lg:block">Launch with confidence</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-slate-300 lg:flex" aria-label="Primary">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="transition hover:text-white">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/contact"
            className="hidden rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-white/40 hover:text-white lg:inline-flex"
          >
            Contact
          </Link>
          <NavLink to="/scan" className="btnPrimary">
            Start scan
          </NavLink>
        </div>
      </div>
      {pathname !== "/" ? null : (
        <div className="hidden h-0.5 w-full bg-gradient-to-r from-transparent via-purple-500/40 to-transparent lg:block" />
      )}
    </header>
  );
}
