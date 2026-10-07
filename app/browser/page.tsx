import AppShell from "@/components/AppShell";
import BrowserViewport from "@/components/browser/BrowserViewport";
import BrowserStatusBanner from "@/components/browser/BrowserStatusBanner";

export default function BrowserPage() {
  return <AppShell title="Browser"><BrowserStatusBanner /><BrowserViewport /></AppShell>;
}
