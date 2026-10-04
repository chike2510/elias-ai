export type WardrobeItem = {
  id: string;
  name: string;
  category: "top" | "bottom" | "dress" | "layer" | "shoe" | "accessory";
  color: string;
  warmth: number;
  vibe?: string;
};
export type OutfitContext = { weather: "Mild" | "Cool" | "Warm"; vibe: string; occasion: string };
export type OutfitSuggestion = { items: WardrobeItem[]; note: string };
export function buildOutfit(items: WardrobeItem[], context: OutfitContext, variation?: number): OutfitSuggestion | null;
export type BudgetEntry = { id: string; name: string; amount: number; category: string; date: string };
export type BudgetSummary = {
  spent: number;
  planned: number;
  remaining: number;
  percent: number;
  categories: Array<{ category: string; amount: number; limit: number; remaining: number; percent: number }>;
};
export function getBudgetSummary(entries: BudgetEntry[], budgets: Record<string, number>): BudgetSummary;
export type ScreenshotSearchable = { name: string; category: string; note: string; tags?: string[] };
export function filterScreenshots<T extends ScreenshotSearchable>(items: T[], query?: string, category?: string): T[];
