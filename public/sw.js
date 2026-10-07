const VERSION = "elias-shell-v2";
const SHELL = ["/", "/chat", "/offline.html", "/branding/elias-logo-192.png", "/branding/elias-logo-512.png"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/image")) return;
  if (request.mode === "navigate") { event.respondWith(fetch(request).catch(() => caches.match("/offline.html"))); return; }
  if (url.pathname.startsWith("/_next/static/") || /\.(?:css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => { const update = fetch(request).then((response) => { if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone())); return response; }).catch(() => cached); return cached || update; }));
  }
});
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });

/* Web Push: show the notification, and tell open tabs so a visible chat can refresh itself. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Elias";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || "", tag: data.tag || undefined, renotify: Boolean(data.tag), data: { url, type: data.type || "" },
      icon: "/branding/elias-logo-192.png", badge: "/branding/elias-logo-192.png",
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => clients.forEach((client) => client.postMessage({ type: "elias:push", url, kind: data.type || "" }))),
  ]));
});

/* Tapping a notification focuses an open Elias tab on the right conversation, or opens one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const same = clients.find((client) => client.url === url);
    if (same) return same.focus();
    const any = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (any) {
      await any.focus();
      if ("navigate" in any) return any.navigate(url).catch(() => self.clients.openWindow(url));
      any.postMessage({ type: "elias:navigate", url });
      return undefined;
    }
    return self.clients.openWindow(url);
  }));
});

/* The browser rotated the subscription: re-subscribe with the same key and tell the server. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old && old.options ? old.options.applicationServerKey : null;
    if (!key) return;
    const next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch("/api/assistant/push", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ subscription: next.toJSON() }) });
    if (old) await fetch("/api/assistant/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ endpoint: old.endpoint }) });
  })().catch(() => undefined));
});
