import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => readFileSync(path.resolve(file), "utf8");

test("list screens show a retryable error card when the first load fails, not an empty state", () => {
  for (const [file, list] of [["components/screens/StudioScreen.tsx", "images"], ["components/screens/ResearchScreen.tsx", "reports"], ["components/screens/AutomationsScreen.tsx", "items"]]) {
    const source = read(file);
    assert.match(source, new RegExp(`!${list} && loadError \\? <ErrorCard text=\\{loadError\\} onRetry=`), `${file} shows ErrorCard on load failure`);
    assert.ok(!source.includes("setItems((current) => current || [])") && !source.includes("setImages((current) => current || [])"), `${file} no longer fakes an empty list on failure`);
  }
  assert.match(read("components/screens/JobsSection.tsx"), /error && !jobs \? <ErrorCard text=\{error\} onRetry=/);
});

test("connection lists have loading and retry states", () => {
  const connectors = read("components/screens/ConnectorsScreen.tsx");
  assert.match(connectors, /if \(!status\) return <section className="el-section el-connections"/);
  assert.match(connectors, /<ListSkeleton rows=\{3\} \/>/);
  assert.match(connectors, /Couldn't check your connections\.<\/span><button type="button" onClick=\{load\}>Retry/);
  assert.match(read("components/screens/YouScreen.tsx"), /Couldn't check connections right now\.<\/span><button type="button" onClick=\{loadStatus\}>Retry/);
});
