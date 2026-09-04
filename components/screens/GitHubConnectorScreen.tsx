"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Github, Link2, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Repo = { id: number; fullName: string; name: string; private: boolean; description: string; url: string; defaultBranch: string; language: string; canWrite?: boolean };

export default function GitHubConnectorScreen() {
  const [connected, setConnected] = useState(false);
  const [writeReady, setWriteReady] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  async function loadRepos() { setLoading(true); try { const response = await fetch("/api/github/repos", { cache: "no-store" }); const data = await response.json() as { connected?: boolean; writeReady?: boolean; repositories?: Repo[]; message?: string }; setConnected(Boolean(data.connected && response.ok)); setWriteReady(Boolean(data.writeReady)); setRepos(data.repositories || []); setMessage(data.message || ""); } catch { setConnected(false); setWriteReady(false); setMessage("Could not load GitHub repositories."); } finally { setLoading(false); } }
  async function disconnectGithub() { setLoading(true); setMessage(""); setNotice(""); try { const response = await fetch("/api/connect/github/disconnect", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Could not disconnect GitHub.");     setConnected(false); setWriteReady(false); setRepos([]); setMessage("GitHub disconnected. Authorize again to choose repositories or another account."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not disconnect GitHub."); } finally { setLoading(false); } }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const messages: Record<string, string> = {
      github_repository_not_configured: "Repository OAuth is not configured on the server. Add the repository client ID and secret in Vercel, then redeploy.",
      github_account_mismatch: "Authorize the same GitHub account used to sign in to Elias.",
      github_profile: "GitHub returned an incomplete profile. Please try again.",
      github_token_exchange: "GitHub did not issue a repository access token. Please try again.",
      oauth_state: "The GitHub authorization expired or was opened in another session. Please authorize again.",
    };
    void loadRepos().finally(() => {
      if (params.get("connected") === "github") setNotice("Repository access was authorized. Elias is checking the repositories available to this account.");
      if (error) setMessage(messages[error] || `GitHub authorization was not completed (${error}).`);
    });
  }, []);
  const filtered = repos.filter((repo) => `${repo.fullName} ${repo.description}`.toLowerCase().includes(query.toLowerCase()));
  return <AppShell title="GitHub"><main className="screen connector-detail-screen"><div className="mobile-screen-heading"><Link href="/connectors" aria-label="Back to connectors"><ArrowLeft size={19} /></Link><h1>GitHub</h1><span className="detail-menu">•••</span></div><section className="connector-hero-card"><span className="connector-hero-icon"><Github size={31} /></span><h2>GitHub</h2><p>Access repositories, review code changes, track issues, and connect project context to Elias.</p></section>{notice ? <p className="connector-notice">{notice}</p> : null}<section className="detail-list"><div><span>Connector type</span><strong>OAuth App</strong></div><div><span>Authorization</span><strong>{connected ? "This Elias account" : "Not connected"}</strong></div><div><span>Repositories</span><strong>{connected ? repos.length : "—"}</strong></div><div><span>Commit access</span><strong>{connected ? (writeReady ? "Enabled" : "Reconnect required") : "—"}</strong></div></section><section className="connector-auth-card">{connected ? <><div className="connected-heading"><CheckCircle2 size={18} /><span><strong>GitHub connected</strong><small>{writeReady ? "This Elias account can read repositories and send explicitly confirmed commits." : "Repository reading is connected, but commit access needs a one-time reconnect."}</small></span></div>{connected && !writeReady ? <a className="secondary connector-reconnect" href="/api/connect/github">Reconnect for commit access</a> : null}<button type="button" className="secondary connector-disconnect" onClick={() => void disconnectGithub()} disabled={loading}>{loading ? "Disconnecting…" : "Disconnect GitHub"}</button></> : <><div className="auth-heading"><Link2 size={18} /><span><strong>Authorize GitHub</strong><small>GitHub will open its confirmation screen. Choose the repositories Elias may access.</small></span></div><a className="primary wide connector-cta" href="/api/connect/github"><ShieldCheck size={15} /> Authorize GitHub account</a><button type="button" className="secondary connector-disconnect" onClick={() => void disconnectGithub()} disabled={loading}>{loading ? "Clearing…" : "Disconnect GitHub"}</button></>}{message ? <p className="connector-help">{message}</p> : null}</section>{connected ? <section className="repos-panel"><div className="panel-head"><span><Github size={16} /><strong>Available repositories</strong></span><b>{repos.length}</b></div><div className="searchbox repo-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" /></div>{loading ? <div className="repo-loading"><LoaderCircle className="spin" size={17} /> Loading repositories…</div> : filtered.length ? <div className="repo-list">{filtered.map((repo) => { const [owner, name] = repo.fullName.split("/"); return <Link className="repo-row" href={`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`} key={repo.id}><span className="repo-avatar"><Github size={14} /></span><span><strong>{repo.fullName}</strong><small>{repo.description}</small><em>{repo.private ? "Private" : "Public"} · {repo.language} · {repo.defaultBranch}</em></span><span className="repo-external-link" aria-hidden="true"><ExternalLink size={14} /></span></Link>; })}</div> : <div className="repo-empty">No repositories match this search.</div>}</section> : null}<div className="connector-links"><a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub Developer Settings <ExternalLink size={13} /></a><a href="https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user" target="_blank" rel="noreferrer">GitHub repository API <ExternalLink size={13} /></a></div></main></AppShell>;
}
