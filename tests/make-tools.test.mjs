import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const make = readFileSync(new URL("../lib/assistant/makeTools.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../lib/assistant/tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("../lib/assistant/agent.ts", import.meta.url), "utf8");
const cards = readFileSync(new URL("../components/chat/MakeCards.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../lib/assistant/modelRouter.ts", import.meta.url), "utf8");

test("make tools: image, file and preview are chat tools with prompt rules", () => {
  for (const name of ["generate_image", "create_file", "show_preview"]) assert.match(make, new RegExp(`name: "${name}"`));
  assert.match(tools, /\.\.\.MAKE_TOOLS/);
  assert.match(agent, /\$\{MAKE_RULES\}/);
  assert.match(make, /never ask the user to supply text/i);
});

test("make tools: previews run sandboxed without same-origin access", () => {
  assert.match(cards, /sandbox="allow-scripts[^"]*"/);
  assert.doesNotMatch(cards, /allow-same-origin/);
});

test("make tools: image/pdf/preview requests route past the fast model", () => {
  for (const word of ["image", "photo", "pdf", "preview", "calculator"]) assert.ok(router.includes(word), word);
});
