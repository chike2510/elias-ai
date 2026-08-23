# Elias Mobile PWA Design

## Goal

The Elias PWA should make the existing mobile-first web app installable and app-like while preserving the server as the source of truth for authentication, conversations, tasks, connectors, tool outputs, and Goal Progress Card events.

The PWA should provide an offline app shell and reliable reconnect behavior, but it must not pretend that private conversations, live tasks, connector data, or web-search results are available offline.

## 1. PWA manifest

Use a Next.js metadata route at `app/manifest.ts`. This keeps the manifest typed and allows the existing branding assets to be referenced from `public/branding`.

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elias — your intelligence layer",
    short_name: "Elias",
    description: "A mobile-first AI workspace for coding, research, study, files, and agents.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#09090d",
    theme_color: "#09090d",
    lang: "en",
    categories: ["productivity", "business", "utilities"],
    icons: [
      { src: "/branding/elias-logo-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/branding/elias-logo-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ],
    shortcuts: [
      { name: "New chat", short_name: "New chat", url: "/chat", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "Projects", short_name: "Projects", url: "/projects", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "Library", short_name: "Library", url: "/files", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] }
    ],
    share_target: {
      action: "/share",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" }
    }
  };
}
```

The current `app/layout.tsx` should also add mobile browser metadata:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090d"
};

export const metadata: Metadata = {
  ...existingMetadata,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Elias" }
};
```

## 2. Service-worker policy

Create `public/sw.js`. The worker should be intentionally conservative. It may cache the app shell and immutable static files, but it must never cache authenticated API responses or task state.

```js
const VERSION = "elias-shell-v1";
const SHELL = ["/", "/chat", "/offline.html", "/branding/elias-logo-192.png", "/branding/elias-logo-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/image")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || /\.(?:css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => {
      const update = fetch(request).then((response) => {
        if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || update;
    }));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

The important rule is that `/api/chat`, `/api/tasks`, `/api/tasks/:id/events`, `/api/web/search`, `/api/github`, `/api/mcp`, `/api/documents`, and `/api/extension` must always go to the network. A stale cached task or connector response would be worse than an offline error.

## 3. Registration

Add a small client component such as `components/PwaRegistration.tsx` and render it once in `app/layout.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export default function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
```

The service worker should not control the first page load until it has installed successfully. On a new version, the app can show a small “Update Elias” prompt when `registration.waiting` exists, then send `SKIP_WAITING` only after the user confirms.

## 4. Share-to-Elias target

Add `app/share/page.tsx`. The page should read `title`, `text`, and `url` from the query string, show a preview, and require the user to choose an instruction before creating a task. It should not silently submit shared content.

```tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function SharePage() {
  const params = useSearchParams();
  const router = useRouter();
  const [instruction, setInstruction] = useState("Summarize and verify this shared page using current sources.");
  const title = params.get("title") || "Shared page";
  const text = params.get("text") || "";
  const url = params.get("url") || "";
  const submit = () => {
    const context = [title, url, text].filter(Boolean).join("\\n");
    router.replace(`/chat?prompt=${encodeURIComponent(`${instruction}\\n\\n[Shared from mobile]\\n${context}`)}`);
  };

  return <main className="share-capture-screen">
    <span className="eyebrow">SHARED WITH ELIAS</span>
    <h1>{title}</h1>
    {url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : null}
    {text ? <p>{text.slice(0, 1200)}</p> : null}
    <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
    <button type="button" onClick={submit}>Continue in Elias</button>
  </main>;
}
```

The share target should redirect into the existing unified chat, where the server can create the task and render the same Goal Progress Card. The shared URL and text must be labeled as user-provided context and independently verified by Elias.

## 5. Install experience

Add an install prompt component that listens for `beforeinstallprompt`, stores the deferred event in memory, and displays a subtle action in the profile or home screen. Do not show it on every page load. Display it after the user has completed a meaningful action or visited twice.

For iOS, there is no equivalent install event. Show a short manual instruction only when the browser is Safari on iOS: “Tap Share, then Add to Home Screen.”

## 6. Mobile navigation behavior

The open-chat route should continue using the compact top-left back button requested by the user. The PWA manifest should start at `/chat`, not the dashboard, so an installed Elias app opens directly into the conversation-first experience. The persistent bottom navigation can remain on `/`, `/projects`, and `/files`, but should stay hidden inside `/chat?id=...`.

## 7. Offline behavior

| Situation | Expected behavior |
|---|---|
| App shell offline | Elias opens the cached offline page or previously cached shell route |
| Existing conversation offline | Show cached UI if available, but label messages as read-only until reconnect |
| Sending a message offline | Keep the draft locally and show “Waiting for connection”; do not claim it was sent |
| Running task offline | Show the last persisted Goal Progress Card snapshot with “Reconnecting…” |
| Web search offline | Show an explicit unavailable state; never synthesize current facts from cache |
| Connector action offline | Disable the action and require reconnect plus approval |

The client should use the existing local persistence layer for drafts and cached task snapshots, but server acknowledgements remain required before a message, task step, artifact, commit, deployment, or connector action is marked complete.

## 8. Acceptance tests

The first PWA release is ready when the following checks pass:

1. Chrome on Android offers **Install app** and opens Elias in standalone mode.
2. The installed app opens at `/chat` with the dark theme and safe-area spacing.
3. Sharing a public URL from another mobile app opens `/share` with the title, text, and URL preview.
4. Pressing **Continue in Elias** opens a new chat with the shared context visible before submission.
5. The service worker serves the shell when offline but does not intercept or cache authenticated API calls.
6. A task started before connectivity loss shows its last Goal Progress Card state and resumes polling after reconnect.
7. A new service-worker version can be accepted from an explicit update prompt.
8. The browser extension and mobile PWA create tasks through the same task API and display the same step statuses.
