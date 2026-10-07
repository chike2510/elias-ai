import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elias — your intelligence layer",
    short_name: "Elias",
    description: "Your personal AI: chat, email, calendar, reminders and the web.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f8f7f4",
    theme_color: "#f8f7f4",
    lang: "en",
    categories: ["productivity", "business", "utilities"],
    icons: [
      { src: "/branding/elias-logo-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/branding/elias-logo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New chat", short_name: "New chat", url: "/chat", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "Tasks", short_name: "Tasks", url: "/tasks", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "You", short_name: "You", url: "/you", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
    ],
    share_target: { action: "/share", method: "POST", enctype: "multipart/form-data", params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["application/pdf", "text/plain", "text/markdown", "image/*"] }] } },
  };
}
