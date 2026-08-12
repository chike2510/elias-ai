"use client";

import Link from "next/link";
import { FileText, Folder, Home, Menu, MessageSquare, Mic, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import HistoryDrawer from "@/components/HistoryDrawer";

export default function AppShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="icon-btn"
          onClick={() => setHistoryOpen(true)}
          aria-label="Open conversation history"
        >
          <Menu size={20} />
        </button>

        <Link href="/" className="brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <span>ELIAS</span>
          <i />
        </Link>

        <div className="top-actions">
          {title ? <span className="top-title">{title}</span> : null}
          <Link className="icon-btn" href="/chat" aria-label="Open chat">
            <MessageSquare size={19} />
          </Link>
          <span className="avatar">E</span>
        </div>
      </header>

      <div className="app-content">{children}</div>

      <nav className="bottom-nav">
        <Nav href="/" label="Home" icon={Home} active={pathname === "/"} />
        <Nav
          href="/projects"
          label="Projects"
          icon={Folder}
          active={pathname.startsWith("/projects")}
        />
        <Link className="assistant-fab" href="/chat" aria-label="Open ELIAS chat">
          <Sparkles size={23} />
        </Link>
        <Nav
          href="/files"
          label="Files"
          icon={FileText}
          active={pathname.startsWith("/files")}
        />
        <Nav
          href="/studio"
          label="Studio"
          icon={Mic}
          active={pathname.startsWith("/studio")}
        />
      </nav>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

function Nav({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  active: boolean;
}) {
  return (
    <Link href={href} className={`nav-item ${active ? "active" : ""}`}>
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  );
}
