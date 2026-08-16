"use client";

import { Github, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(new URLSearchParams(window.location.search).get("error")); }, []);
  const message = error === "github_not_configured" ? "GitHub OAuth is not configured for this deployment yet." : error ? "GitHub sign-in could not be completed. Please try again." : "";
  return <main className="auth-screen"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark"><Sparkles size={19} /></span><span className="brand-wordmark">ELIAS</span><i /></div><p className="eyebrow">YOUR INTELLIGENCE LAYER</p><h1>Make the workspace yours.</h1><p className="auth-copy">Sign in with GitHub to create your Elias account. Your conversations, projects, tasks, files, and connector permissions will belong to you.</p>{message ? <div className="auth-error">{message}</div> : null}<a className="github-signin" href="/api/auth/github"><Github size={18} /> Continue with GitHub</a><div className="auth-note"><ShieldCheck size={15} /><span>GitHub account access and repository access are separate permissions. Elias will not read repositories until you connect them.</span></div><p className="auth-back">A GitHub account is required to use the Elias workbench.</p></section></main>;
}
