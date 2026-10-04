import type { Metadata } from "next";
import ScreenshotOrganizer from "@/components/idea-apps/ScreenshotOrganizer";

export const metadata: Metadata = { title: "Screenshot Organizer · ELIAS Idea Studio", description: "A local-only screenshot library with manual tags and search." };

export default function ScreenshotsPage() {
  return <ScreenshotOrganizer />;
}
