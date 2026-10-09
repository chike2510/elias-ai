import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve("components/screens/TaskWorkspace.tsx"), "utf8");
const css = readFileSync(path.resolve("app/v5-polish.css"), "utf8");

test("workbench uses the v2 el-* page, list and card styles", () => {
  for (const name of ["el-page", "el-page-head", "el-section", "el-list", "el-card", "el-btn el-btn-primary", "el-error-card", "el-approval", "el-empty-line"]) assert.ok(source.includes(name), `missing ${name}`);
  for (const legacy of ["task-focus-card", "task-start-guide", "quiet-card", "GradientBackdrop", "StepTracker", "className=\"primary", "className=\"secondary"]) assert.ok(!source.includes(legacy), `legacy ${legacy} still used`);
});

test("workbench has loading, empty and error states", () => {
  assert.match(source, /loadingTask \? <section className="el-section" aria-busy="true"/);
  assert.match(source, /<ListSkeleton rows=\{4\} \/>/);
  assert.match(source, /No plan yet/);
  assert.match(source, /No activity yet/);
  assert.match(source, /No files yet/);
  assert.match(source, /Couldn't load this task/);
});

test("workbench CSS is theme-token only and keeps 44px targets", () => {
  const block = css.slice(css.indexOf("/* v5: task workbench"));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block), "no hard-coded colours");
  assert.match(block, /\.v5-wb-controls \.el-btn-sm \{ min-height: var\(--tap\); \}/);
  assert.match(block, /\.v5-wb-fold > summary \{[^}]*min-height: var\(--tap\)/);
});
