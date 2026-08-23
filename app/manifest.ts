import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elias — your intelligence layer",
    short_name: "Elias",
    description: "A mobile-first AI workspace for coding, research, files, and agents.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#09090d",
    theme_color: "#09090d",
    lang: "en",
    categories: ["productivity", "business", "utilities"],
    icons: [
      { src: "/branding/elias-logo-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/branding/elias-logo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New chat", short_name: "New chat", url: "/chat", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "Projects", short_name: "Projects", url: "/projects", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
      { name: "Library", short_name: "Library", url: "/files", icons: [{ src: "/branding/elias-logo-192.png", sizes: "192x192" }] },
    ],
    share_target: { action: "/share", method: "POST", enctype: "multipart/form-data", params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["application/pdf", "text/plain", "text/markdown", "image/*"] }] } },
  };
}
