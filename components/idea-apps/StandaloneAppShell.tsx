import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Brush, Camera, Shirt, Wallet } from "lucide-react";

type AppHref = "/outfit" | "/museum" | "/budget" | "/screenshots";

const apps: Array<{ href: AppHref; label: string; icon: LucideIcon }> = [
  { href: "/outfit", label: "Outfit", icon: Shirt },
  { href: "/museum", label: "Museum", icon: Brush },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/screenshots", label: "Screenshots", icon: Camera },
];

export default function StandaloneAppShell({
  active,
  children,
}: Readonly<{ active: AppHref; children: React.ReactNode }>) {
  return (
    <div className="idea-app">
      <header className="idea-topbar">
        <Link className="idea-brand" href="/" aria-label="Back to ELIAS home">
          <span className="idea-brand-mark">E</span>
          <span className="idea-brand-copy"><strong>ELIAS</strong><small>IDEA STUDIO</small></span>
        </Link>
        <nav className="idea-switcher" aria-label="Standalone app experiences">
          {apps.map(({ href, label, icon: Icon }) => (
            <Link
              className={`idea-switch-link${active === href ? " is-active" : ""}`}
              href={href}
              key={href}
              aria-current={active === href ? "page" : undefined}
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <Link className="idea-back-link" href="/">
          <span>ELIAS workspace</span><ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </header>
      <main className="idea-main">{children}</main>
      <footer className="idea-footer">
        <span>Four independent product sketches</span>
        <span>Shared codebase · local-first prototype</span>
      </footer>
    </div>
  );
}
