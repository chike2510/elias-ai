import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/research.ts");

function load() {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const { parseReport, researchPrompt } = load();

test("research prompt asks for the three sections", () => {
  const prompt = researchPrompt("  best   phones  ");
  assert.match(prompt, /best phones/);
  for (const part of ["## Summary", "## Key findings", "## Sources"]) assert.ok(prompt.includes(part));
});

test("parses a well-formed report", () => {
  const report = parseReport(`## Summary
The **Tecno Spark 20** is the best value right now [1].

## Key findings
- Prices start at ₦150,000 [1, 2].
- Battery life leads the class [2].

## Sources
1. [Jumia listing](https://www.jumia.com.ng/spark-20) - Jumia, Oct 2026
2. [GSMArena review](https://www.gsmarena.com/review.php) – GSMArena
`);
  assert.equal(report.structured, true);
  assert.equal(report.summary, "The Tecno Spark 20 is the best value right now [1].");
  assert.deepEqual(report.findings, ["Prices start at ₦150,000 [1, 2].", "Battery life leads the class [2]."]);
  assert.equal(report.sources.length, 2);
  assert.deepEqual(report.sources[0], { n: 1, title: "Jumia listing", url: "https://www.jumia.com.ng/spark-20", domain: "jumia.com.ng", note: "Jumia, Oct 2026" });
  assert.equal(report.sources[1].domain, "gsmarena.com");
});

test("bold headings and bare URLs work", () => {
  const report = parseReport(`**Summary:**
Short answer here.

**Sources**
- Official site: https://example.org/page.
- [2] Blog https://blog.example.com/post`);
  assert.equal(report.summary, "Short answer here.");
  assert.equal(report.sources[0].url, "https://example.org/page");
  assert.equal(report.sources[0].title, "Official site");
  assert.equal(report.sources[1].n, 2);
});

test("unstructured text still yields a summary and its links", () => {
  const report = parseReport("Rates went up in May, see [CBN](https://cbn.gov.ng/rates) and https://news.example.com/a.\n\n- point one\n- point two");
  assert.equal(report.structured, false);
  assert.match(report.summary, /Rates went up in May, see CBN/);
  assert.deepEqual(report.findings, ["point one", "point two"]);
  assert.deepEqual(report.sources.map((item) => item.domain), ["cbn.gov.ng", "news.example.com"]);
  assert.deepEqual(parseReport("").sources, []);
});

test("research jobs started from chat get a report card (findings + sources), plain answers don't", () => {
  const { reportCardFor, RESEARCH_FORMAT } = load();
  assert.match(RESEARCH_FORMAT, /## Key findings/);
  const card = reportCardFor("Phones", "job_1", "## Summary\nThe Tecno Spark is the pick [1].\n## Key findings\n- Cheapest at 120k [1]\n## Sources\n1. [Jumia](https://www.jumia.com.ng/x) - Jumia");
  assert.equal(card.kind, "report");
  assert.equal(card.jobId, "job_1");
  assert.equal(card.findings.length, 1);
  assert.equal(card.sources[0].domain, "jumia.com.ng");
  assert.match(card.summary, /Tecno Spark/);
  assert.equal(reportCardFor("Suya", "job_2", "**Glover Court Suya** is the pick: consistent, open late."), null);
});

test("chat renders the report card and jobs attach it", () => {
  const cards = readFileSync(path.resolve("components/chat/Cards.tsx"), "utf8");
  const jobs = readFileSync(path.resolve("lib/assistant/jobs.ts"), "utf8");
  assert.match(cards, /card\.kind === "report"\) return <ResearchReportCardView/);
  assert.match(jobs, /reportCardFor\(job\.title, job\.id, result\)/);
  assert.match(jobs, /job\.kind === "research" && !job\.prompt\.includes\("## Key findings"\)/);
});
