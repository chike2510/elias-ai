"use client";

import "@/components/brain.css";
import { Copy, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/chatClient";

type LinkState = { configured: boolean; bot: string | null; link: { username: string | null; linkedAt: string } | null };

/** Link a Telegram chat to this account with a one-time code (valid 15 minutes). */
export default function TelegramLink() {
  const [state, setState] = useState<LinkState | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string; bot: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<LinkState>("/api/telegram/link").then(setState).catch(() => setState(null)); }, []);
  if (!state) return null;
  async function newCode() { setBusy(true); setError(null); try { setCode(await api("/api/telegram/link", { method: "POST", body: "{}" })); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't make a code."); } setBusy(false); }
  async function unlink() { setBusy(true); await api("/api/telegram/link", { method: "DELETE" }).catch(() => undefined); setState({ ...state!, link: null }); setBusy(false); }
  const bot = code?.bot || state.bot;
  return <section className="el-section">
    <h2>Telegram</h2>
    <div className="el-tg">
      {!state.configured ? <p>Talk to Elias from Telegram. The owner needs to create a bot with @BotFather and add TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET on the server.</p>
        : state.link ? <>
          <p>Linked{state.link.username ? ` to @${state.link.username}` : ""}. Message the bot any time: same memory, same tools. Approvals still happen here in the app.</p>
          <div className="el-tg-actions"><button type="button" className="el-btn el-btn-sm" disabled={busy} onClick={() => void unlink()}>Unlink</button></div>
        </> : code ? <>
          <p>Send this code to {bot ? <a href={`https://t.me/${bot}?start=${code.code}`} target="_blank" rel="noreferrer">@{bot}</a> : "the Elias bot"} on Telegram within 15 minutes.</p>
          <div className="el-tg-code"><span>{code.code}</span><button type="button" className="el-icon-btn" aria-label="Copy code" onClick={() => void navigator.clipboard?.writeText(code.code)}><Copy size={16} /></button></div>
          <div className="el-tg-actions">{bot ? <a className="el-btn el-btn-primary el-btn-sm" href={`https://t.me/${bot}?start=${code.code}`} target="_blank" rel="noreferrer"><Send size={15} /> Open Telegram</a> : null}<button type="button" className="el-btn el-btn-sm" disabled={busy} onClick={() => void newCode()}>New code</button></div>
        </> : <>
          <p>Chat with Elias from Telegram too. You'll get a one-time code to send to the bot.</p>
          <div className="el-tg-actions"><button type="button" className="el-btn el-btn-primary el-btn-sm" disabled={busy} onClick={() => void newCode()}><Send size={15} /> Link Telegram</button></div>
        </>}
      {error ? <p>{error}</p> : null}
    </div>
  </section>;
}
