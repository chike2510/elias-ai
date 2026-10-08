import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/agent/page.tsx", "utf8");
const ui = readFileSync("components/code/CodeWorkspace.tsx", "utf8");
const css = readFileSync("app/v4-code.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

test("/agent renders the CodeWorkspace", () => {
  assert.match(page, /import CodeWorkspace from "@\/components\/code\/CodeWorkspace"/);
});

test("workspace has a compact header with repo picker, Files/Diff/Checks/Agent tabs and Run checks / Open PR", () => {
  assert.match(ui, /className="v4c-head"/);
  assert.match(ui, /RepoPicker/);
  assert.match(ui, /\/api\/github\/repos/);
  for (const label of ["Files", "Diff", "Checks", "Agent"]) assert.match(ui, new RegExp(`label: "${label}"`));
  assert.match(ui, /role="tablist"/);
  assert.match(ui, /Run checks/);
  assert.match(ui, /Open PR/);
  assert.match(ui, /\/api\/code\/chat/);
  assert.match(ui, /action: "verify"/);
  assert.match(ui, /ApprovalCard/);
});

test("workspace styles use theme tokens and 44px tap targets", () => {
  assert.match(layout, /import "\.\/v4-code\.css"/);
  assert.match(css, /\.v4c-repo \{[^}]*min-height: var\(--tap\)/);
  assert.match(css, /\.v4c-tree button \{[^}]*min-height: var\(--tap\)/);
  assert.match(css, /\.v4c-actions \.el-btn \{[^}]*min-height: var\(--tap\)/);
  assert.match(css, /\.v4c-file \{[^}]*min-height: var\(--tap\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, "no hard-coded colors (dark mode follows tokens)");
  assert.match(css, /\.v4c-search input \{[^}]*font-size: 16px/, "16px inputs avoid iOS zoom");
});
