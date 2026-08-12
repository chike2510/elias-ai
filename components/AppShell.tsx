"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Folder, FileText, Home, Menu, Mic, Settings2, Sparkles, User } from "lucide-react";
import { useState } from "react";
import ModalSheet from "@/components/ModalSheet";

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20}/></button>
        <Link href="/" className="brand">
          <span className="brand-mark"><Sparkles size={18}/></span>
          <span>ELIAS</span><i />
        </Link>
        <div className="top-actions">
          {title ? <span className="top-title">{title}</span> : null}
          <button className="icon-btn" aria-label="Notifications"><Bell size={19}/></button>
          <span className="avatar">E</span>
        </div>
      </header>

      <div className="app-content">{children}</div>

      <nav className="bottom-nav">
        <Nav href="/" label="Home" icon={Home} active={pathname === "/"} />
        <Nav href="/projects" label="Projects" icon={Folder} active={pathname.startsWith("/projects")} />
        <Link className="assistant-fab" href="/chat" aria-label="Open ELIAS"><Sparkles size={23}/></Link>
        <Nav href="/files" label="Files" icon={FileText} active={pathname.startsWith("/files")} />
        <Nav href="/studio" label="Studio" icon={Mic} active={pathname.startsWith("/studio")} />
      </nav>

      {menuOpen && <ModalSheet onClose={() => setMenuOpen(false)}>
        <div className="drawer-title"><div><span className="brand-mark"><Sparkles size={18}/></span><strong>ELIAS</strong></div><button onClick={() => setMenuOpen(false)}>×</button></div>
        <div className="drawer-section">
          <p>Workspace</p>
          <Link href="/research" onClick={() => setMenuOpen(false)}>Research</Link>
          <Link href="/study" onClick={() => setMenuOpen(false)}>Study & documents</Link>
          <Link href="/files" onClick={() => setMenuOpen(false)}>Artifacts & files</Link>
        </div>
        <div className="drawer-section">
          <p>System</p>
          <Link href="/projects/storeos" onClick={() => setMenuOpen(false)}>StoreOS</Link>
          <Link href="/agent/storeos" onClick={() => setMenuOpen(false)}>Agent activity</Link>
          <Link href="/studio" onClick={() => setMenuOpen(false)}>Voice + camera</Link>
          <a href="#settings"> <Settings2 size={15}/> Settings</a>
        </div>
      </ModalSheet>}
    </div>
  );
}

function Nav({ href, label, icon: Icon, active }: { href: string; label: string; icon: any; active: boolean }) {
  return <Link href={href} className={`nav-item ${active ? "active" : ""}`}><Icon size={18}/><span>{label}</span></Link>;
}