"use client";

import { CalendarDays, CloudSun, ExternalLink, Mail, Plug, Repeat } from "lucide-react";
import type { Card, ConnectCard as ConnectInfo } from "@/lib/chatClient";
import { ConnectorListCard, MemoryReview } from "@/components/chat/ExtraCards";
import { DiffCard } from "@/components/code/DiffCard";
import { SiteIcon, SourcesCard } from "@/components/chat/SourcesCard";
import { ResearchReportCardView } from "@/components/research/ReportView";
import { googleConnectCopy } from "@/lib/connectCopy";

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function when(value?: string) {
  if (!value) return "";
  if (!value.includes("T")) return "All day";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function shortDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function MessageCard({ card }: { card: Card }) {
  if (card.kind === "list") return <ConnectorListCard card={card} />;
  if (card.kind === "diff") return <DiffCard card={card} />;
  if (card.kind === "report") return <ResearchReportCardView card={card} />;
  if (card.kind === "memory_review") return <MemoryReview card={card} />;
  if (card.kind === "links") return <SourcesCard title={card.title} domains={card.items.map((item) => host(item.url))} count={card.items.length}>
    <ul className="el-card-rows">{card.items.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer" className="el-card-row">
      <SiteIcon domain={host(item.url)} size={20} className="el-favicon" />
      <span className="el-card-text"><strong>{item.title}</strong><small>{host(item.url)}{item.snippet ? ` · ${item.snippet}` : ""}</small></span>
      <ExternalLink size={14} className="el-card-trail" />
    </a></li>)}</ul>
  </SourcesCard>;
  if (card.kind === "emails") return <section className="el-card" aria-label={card.title}>
    <header className="el-card-head"><Mail size={15} /> {card.title}</header>
    <ul className="el-card-rows">{card.items.map((item, index) => <li key={item.id || index}><a className="el-card-row" href={item.id ? `https://mail.google.com/mail/u/0/#inbox/${item.id}` : undefined} target="_blank" rel="noreferrer">
      <span className={`el-dot ${item.unread ? "on" : ""}`} aria-label={item.unread ? "Unread" : undefined} />
      <span className="el-card-text"><strong>{item.from || "Unknown sender"}</strong><span className="el-card-sub">{item.subject}</span>{item.snippet ? <small>{item.snippet}</small> : null}</span>
      <time className="el-card-trail">{shortDate(item.date)}</time>
    </a></li>)}</ul>
  </section>;
  if (card.kind === "events") return <section className="el-card" aria-label={card.title}>
    <header className="el-card-head"><CalendarDays size={15} /> {card.title}</header>
    <ul className="el-card-rows">{card.items.map((item, index) => <li key={item.id || index}><a className="el-card-row" href={item.link} target="_blank" rel="noreferrer">
      <span className="el-time">{when(item.start)}</span>
      <span className="el-card-text"><strong>{item.title}</strong>{item.location ? <small>{item.location}</small> : item.end ? <small>until {when(item.end)}</small> : null}</span>
    </a></li>)}</ul>
  </section>;
  if (card.kind === "weather") return <section className="el-card el-weather" aria-label="Weather">
    <CloudSun size={30} strokeWidth={1.5} />
    <div><strong>{card.now !== undefined ? `${card.now}°` : card.summary}</strong><span>{card.summary} · {card.place}</span>{card.high !== undefined ? <small>H {card.high}° · L {card.low}°{card.rainChance ? ` · ${card.rainChance}% rain` : ""}</small> : null}</div>
  </section>;
  if (card.kind === "schedule") return <section className="el-card el-card-compact"><Repeat size={15} /><span><strong>{card.name}</strong><small>{card.when}</small></span><a href="/tasks">Manage</a></section>;
  return null;
}

export function ConnectCard({ connect, returnTo }: { connect: ConnectInfo; returnTo: string }) {
  if (connect.provider === "google") {
    const copy = googleConnectCopy(connect, returnTo);
    return <section className="el-card el-connect">
      <span className="el-connect-mark google" aria-hidden="true">G</span>
      <div className="el-connect-copy"><strong>{copy.title}</strong><small>{copy.line}{connect.reconnect && connect.email ? ` (${connect.email})` : ""}</small></div>
      {copy.button ? <a className="el-btn el-btn-primary" href={copy.href}>{copy.button}</a> : <span className="el-pill">Not configured yet</span>}
    </section>;
  }
  return <section className="el-card el-connect">
    <span className="el-connect-mark" aria-hidden="true"><Plug size={16} /></span>
    <div className="el-connect-copy"><strong>Browser not configured</strong><small>Interactive browsing (forms, carts, bookings) needs a Cloudflare Browser Run or Browserbase key on the server. Reading web pages still works.</small></div>
    <span className="el-pill">Not configured</span>
  </section>;
}
