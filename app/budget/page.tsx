import type { Metadata } from "next";
import BudgetTracker from "@/components/idea-apps/BudgetTracker";

export const metadata: Metadata = { title: "Smart Budget · ELIAS Idea Studio", description: "A manual, browser-local budget and savings tracker prototype." };

export default function BudgetPage() {
  return <BudgetTracker />;
}
