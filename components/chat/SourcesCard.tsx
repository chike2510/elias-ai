"use client";

import { ChevronDown, Globe2 } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

/** First letter of a domain, for the compact chip ("en.wikipedia.org" → "W"). */
export function domainLetter(domain: string) {
  const parts = domain.replace(/^www\./, "").split(".").filter(Boolean);
  // Drop the public suffix ("com", "co.uk", "com.ng") and take the registrable name.
  if (parts.length > 2 && parts[parts.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2])) parts.pop();
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || domain;
  return (name.match(/[a-z0-9]/i)?.[0] || "?").toUpperCase();
}

/** Unique domains in order, at most `max`. */
export function chipDomains(domains: string[], max = 3) {
  return [...new Set(domains.map((domain) => domain.replace(/^www\./, "")).filter(Boolean))].slice(0, max);
}

/**
 * Collapsed-by-default sources list: one tappable row (globe, "Sources", count, letter chips for the
 * first three domains, chevron) that expands to the full list. Shared by chat link cards and research reports.
 * `openOnHash` opens it when the URL hash starts with that prefix, so citation links still land on their row.
 */
export function SourcesCard({ title = "Sources", domains, count, children, variant = "card", openOnHash }: {
  title?: string; domains: string[]; count?: number; children: ReactNode; variant?: "card" | "inline"; openOnHash?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const total = count ?? domains.length;
  const chips = chipDomains(domains);

  useEffect(() => {
    if (!openOnHash) return;
    const check = () => {
      const hash = window.location.hash;
      if (!hash.startsWith(`#${openOnHash}`)) return;
      setOpen(true);
      // The row was inside a collapsed panel when the browser tried to scroll; scroll again once it has height.
      window.setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 260);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openOnHash]);

  return <section className={`el-sources el-sources-${variant}${open ? " is-open" : ""}`} aria-label={title}>
    <button type="button" className="el-sources-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <Globe2 size={15} aria-hidden="true" className="el-sources-globe" />
      <span className="el-sources-label">{title}</span>
      <span className="el-sources-count" aria-label={`${total} ${total === 1 ? "source" : "sources"}`}>{total}</span>
      <span className="el-sources-chips" aria-hidden="true">{chips.map((domain) => <span key={domain} className="el-sources-chip" title={domain}>{domainLetter(domain)}</span>)}</span>
      <ChevronDown size={16} aria-hidden="true" className="el-sources-chevron" />
    </button>
    <div className="el-sources-panel" id={panelId} role="region" aria-label={`${title} list`} inert={!open}>
      <div className="el-sources-inner">{children}</div>
    </div>
  </section>;
}
