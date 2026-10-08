"use client";

import { ChevronDown, Globe2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** First letter of a domain, for the compact chip ("en.wikipedia.org" → "W"). */
export function domainLetter(domain: string) {
  const parts = domain.replace(/^www\./, "").split(".").filter(Boolean);
  // Drop the public suffix ("com", "co.uk", "com.ng") and take the registrable name.
  if (parts.length > 2 && parts[parts.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2])) parts.pop();
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || domain;
  return (name.match(/[a-z0-9]/i)?.[0] || "?").toUpperCase();
}

/** Bare host of a domain or URL ("https://www.bbc.co.uk/news" → "bbc.co.uk"). */
export function siteHost(domain: string) {
  return domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
}

/** Google's favicon service; a 64px source so it stays sharp on 2x/3x screens. No CSP is set, so a direct URL loads. */
export function faviconUrl(domain: string) {
  const host = siteHost(domain);
  return host && /^[a-z0-9.-]+$/.test(host) ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : "";
}

/**
 * Real site icon with the letter circle as fallback. Google answers unknown domains with a 404 + 16px
 * default globe, so a failed load or a ≤16px image both fall back to the letter.
 */
export function SiteIcon({ domain, size, className }: { domain: string; size: number; className: string }) {
  const host = siteHost(domain);
  const src = faviconUrl(domain);
  const [failed, setFailed] = useState(!src);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => setFailed(!src), [src]);
  // An image that errored before hydration never fires onError, so check it once on mount.
  useEffect(() => {
    const img = image.current;
    if (img?.complete && img.naturalWidth <= 16) setFailed(true);
  }, [src]);
  return <span className={`${className} el-site-icon${failed ? "" : " has-img"}`} title={host || domain} aria-hidden="true">
    {failed ? domainLetter(host || domain) : <img ref={image} src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
      onError={() => setFailed(true)} onLoad={(event) => { if (event.currentTarget.naturalWidth <= 16) setFailed(true); }} />}
  </span>;
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
      <span className="el-sources-chips" aria-hidden="true">{chips.map((domain) => <SiteIcon key={domain} domain={domain} size={18} className="el-sources-chip" />)}</span>
      <ChevronDown size={16} aria-hidden="true" className="el-sources-chevron" />
    </button>
    <div className="el-sources-panel" id={panelId} role="region" aria-label={`${title} list`} inert={!open}>
      <div className="el-sources-inner">{children}</div>
    </div>
  </section>;
}
