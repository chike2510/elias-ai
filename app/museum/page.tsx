import type { Metadata } from "next";
import DigitalMuseum from "@/components/idea-apps/DigitalMuseum";

export const metadata: Metadata = { title: "Digital Art Museum · ELIAS Idea Studio", description: "A small, ad-free public-domain art collection prototype." };

export default function MuseumPage() {
  return <DigitalMuseum />;
}
