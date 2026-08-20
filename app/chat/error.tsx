"use client";

import { useEffect } from "react";

export default function ChatError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Elias Chat route failed", error);
  }, [error]);

  return <main className="screen route-error"><div className="route-error-mark">!</div><p className="eyebrow">ELIAS / chat</p><h1>Chat needs a quick refresh.</h1><p>The conversation state could not be loaded safely. Your task data is preserved; retry the Chat workspace to continue.</p><div className="route-error-actions"><button className="primary" type="button" onClick={() => reset()}>Retry Chat</button><a className="secondary" href="/chat">Start a new chat</a></div></main>;
}
