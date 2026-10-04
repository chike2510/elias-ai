import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOutfit, filterScreenshots, getBudgetSummary } from "../lib/standaloneExperiences.mjs";

const items = [
  { id: "top", name: "Cotton shirt", category: "top", color: "#eee", warmth: 1, vibe: "Classic" },
  { id: "bottom", name: "Denim", category: "bottom", color: "#369", warmth: 1, vibe: "Classic" },
  { id: "layer", name: "Jacket", category: "layer", color: "#789", warmth: 2, vibe: "Classic" },
  { id: "shoe", name: "Loafers", category: "shoe", color: "#642", warmth: 1, vibe: "Classic" },
  { id: "dress", name: "Navy dress", category: "dress", color: "#125", warmth: 1, vibe: "Polished" },
];

test("outfit suggestions use closet pieces, include layers for cool weather, and handle an empty closet", () => {
  const result = buildOutfit(items, { weather: "Cool", vibe: "Classic", occasion: "Work" });
  assert.ok(result);
  assert.deepEqual(result.items.map((item) => item.category), ["top", "bottom", "layer", "shoe"]);
  assert.match(result.note, /cooler weather/i);
  assert.equal(buildOutfit([], { weather: "Mild", vibe: "Relaxed", occasion: "Everyday" }), null);
});

test("a polished outfit can use a dress without requiring separates", () => {
  const result = buildOutfit(items, { weather: "Warm", vibe: "Polished", occasion: "Dinner" });
  assert.equal(result.items[0].id, "dress");
  assert.equal(result.items.some((item) => item.category === "top" || item.category === "bottom"), false);
});

test("budget summaries total spending and keep visual progress bounded at 100 percent", () => {
  const summary = getBudgetSummary([
    { id: "1", name: "Market", amount: 35.25, category: "Food", date: "2026-10-01" },
    { id: "2", name: "Cafe", amount: 14.75, category: "Food", date: "2026-10-02" },
    { id: "3", name: "Train", amount: 55, category: "Travel", date: "2026-10-03" },
  ], { Food: 40, Travel: 100 });
  assert.equal(summary.spent, 105);
  assert.equal(summary.planned, 140);
  assert.equal(summary.remaining, 35);
  assert.equal(summary.percent, 75);
  assert.equal(summary.categories[0].percent, 100);
  assert.equal(summary.categories[0].remaining, -10);
});

test("screenshot search matches names, notes, tags, and category case-insensitively", () => {
  const records = [
    { id: "1", name: "IMG_1402.png", category: "Receipt", note: "Lunch with Jo", tags: ["restaurant", "receipt"] },
    { id: "2", name: "Map.png", category: "Places", note: "Museum entrance", tags: ["address"] },
  ];
  assert.deepEqual(filterScreenshots(records, "jo"), [records[0]]);
  assert.deepEqual(filterScreenshots(records, "ADDRESS", "Places"), [records[1]]);
  assert.deepEqual(filterScreenshots(records, "", "Receipt"), [records[0]]);
});

test("the four experiences have separate routes and the original ELIAS root screen remains mounted", () => {
  const rootPage = readFileSync("app/page.tsx", "utf8");
  assert.match(rootPage, /<HomeScreen\s*\/>/);
  for (const route of ["outfit", "museum", "budget", "screenshots"]) {
    const page = readFileSync(`app/${route}/page.tsx`, "utf8");
    assert.match(page, /export default function/);
  }
});
