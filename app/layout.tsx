import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import PwaRegistration from "@/components/PwaRegistration";

export const metadata: Metadata = {
  title: "ELIAS — your intelligence layer",
  description: "A mobile-first AI workspace for coding, research, study, files and agents.",
  icons: { icon: "/branding/elias-logo-192.png", apple: "/branding/elias-logo-192.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Elias" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090d"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthGate><PwaRegistration />{children}</AuthGate></body>
    </html>
  );
}
