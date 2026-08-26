"use client";

import { useEffect } from "react";

export default function TasksError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Elias Tasks route error", error); }, [error]);
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#07080b", color: "#f5f3f8", fontFamily: "DM Sans, system-ui, sans-serif" }}><section style={{ width: "min(100%, 420px)", padding: 24, border: "1px solid #2b2d38", borderRadius: 22, background: "#12131a" }}><p style={{ color: "#a78bfa", letterSpacing: ".14em", fontSize: 12 }}>ELIAS / TASKS</p><h1 style={{ margin: "10px 0 8px", fontSize: 26 }}>Task could not be opened</h1><p style={{ color: "#9a98a5", lineHeight: 1.5 }}>The task record needs to be refreshed. Your saved task data is still safe.</p><button type="button" onClick={() => reset()} style={{ width: "100%", marginTop: 14, minHeight: 44, border: 0, borderRadius: 12, background: "linear-gradient(145deg,#9164ff,#7139eb)", color: "white", fontWeight: 600 }}>Reload task</button></section></main>;
}
