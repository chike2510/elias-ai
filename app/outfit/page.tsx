import type { Metadata } from "next";
import OutfitPlanner from "@/components/idea-apps/OutfitPlanner";

export const metadata: Metadata = { title: "Outfit Planner · ELIAS Idea Studio", description: "A local-first wardrobe and outfit-planning prototype." };

export default function OutfitPage() {
  return <OutfitPlanner />;
}
