"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import type { GoogleStatus } from "@/lib/chatClient";
import { googleReturnMessage, googleRowView } from "@/lib/googleStatusText";

/** The Google row on You and Connectors: on / renew soon / signed out (Reconnect) / connect / not configured. */
export default function GoogleStatusRow({ google, returnTo, onDisconnect, busy, icon }: { google: GoogleStatus; returnTo: string; onDisconnect?: () => void; busy?: boolean; icon?: React.ReactNode }) {
  const view = googleRowView(google, returnTo);
  const body = <>
    <span className="el-list-icon">{icon || <Mail size={17} />}</span>
    <span className="el-list-text"><strong>Google</strong><small className={view.state === "warn" ? "v5g-warn-text" : undefined}>{view.detail}</small></span>
  </>;
  // OAuth starts on an API route, so it must be a real navigation (<a>), not a client-side Link.
  const action = view.action ? <a className="el-btn el-btn-primary el-btn-sm v5g-action" href={view.href}>{view.action}</a> : null;
  if (onDisconnect) return <div className="el-list-row static v5g-row">{body}
    {action}{view.canDisconnect && view.state !== "warn" ? <button type="button" className="el-btn el-btn-sm" disabled={busy} onClick={onDisconnect}>Disconnect</button> : null}
    {!action && !view.canDisconnect ? <span className={`el-state ${view.state}`}>{view.stateLabel}</span> : null}
  </div>;
  if (action) return <div className="el-list-row static v5g-row">{body}{action}</div>;
  return <Link className="el-list-row v5g-row" href={view.href}>{body}<span className={`el-state ${view.state}`}>{view.stateLabel}</span></Link>;
}

export function GoogleReturnNotice() {
  const [message, setMessage] = useState<ReturnType<typeof googleReturnMessage>>(null);
  useEffect(() => { setMessage(googleReturnMessage(window.location.search)); }, []);
  if (!message) return null;
  return <p className={`el-conn-note v5g-notice ${message.tone}`} role="status">{message.text}</p>;
}
