import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve("components/screens/ProjectsScreen.tsx"), "utf8");

test("projects: open-a-repository accepts owner/repo and github.com links", () => {
  const start = source.indexOf("export function parseRepositoryInput");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 2).replace("export function", "function").replace(/\(value: string\): \{ owner: string; repo: string \} \| undefined/, "(value)");
  const parse = new Function(`${body}; return parseRepositoryInput;`)();
  assert.deepEqual(parse("chike2510/elias-ai"), { owner: "chike2510", repo: "elias-ai" });
  assert.deepEqual(parse("https://github.com/chike2510/elias-ai.git"), { owner: "chike2510", repo: "elias-ai" });
  assert.deepEqual(parse("github.com/vercel/next.js/tree/canary"), { owner: "vercel", repo: "next.js" });
  assert.equal(parse("not a repo"), undefined);
});

test("projects: a rejected GitHub token shows a reconnect card that goes straight to OAuth", () => {
  assert.match(source, /reconnectRequired/);
  assert.match(source, /href="\/api\/connect\/github"/);
  assert.doesNotMatch(source, /authorization expired or was replaced/);
});
