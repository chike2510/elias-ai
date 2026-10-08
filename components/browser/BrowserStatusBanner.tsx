"use client";

import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Status } from "@/lib/chatClient";

/** Says plainly when the real remote browser (Cloudflare Browser Run or Browserbase) is not set up. */
export default function BrowserStatusBanner() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => { void api<Status>("/api/assistant/status").then((status) => setConfigured(status.browser.configured)).catch(() => undefined); }, []);
  if (configured !== false) return null;
  return <div className="el-notice warn el-browser-banner" role="status"><Info size={16} /><span><strong>Browser not configured.</strong> Elias can still read public pages here and in chat. Clicking, typing and checkouts need a Cloudflare Browser Run or Browserbase key on the server.</span></div>;
}
