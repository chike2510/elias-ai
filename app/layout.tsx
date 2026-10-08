import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./background.css";
import "./v4-shell.css";
import AuthGate from "@/components/AuthGate";
import PwaRegistration from "@/components/PwaRegistration";

export const metadata: Metadata = {
  title: "ELIAS — your intelligence layer",
  description: "Elias, your personal AI: chat, email, calendar, reminders and the web in one place.",
  icons: { icon: "/branding/elias-logo-192.png", apple: "/branding/elias-logo-192.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Elias" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f12" },
  ]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthGate><PwaRegistration />{children}</AuthGate></body>
    </html>
  );
}
