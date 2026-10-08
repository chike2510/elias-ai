import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const read = (file) => readFileSync(path.resolve(file), "utf8");

/** Transpiles a TS/TSX file to CommonJS and loads it, resolving "@/..." to other transpiled repo files. */
function load(file, cache = new Map()) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = new Module(full);
  loaded.filename = full;
  loaded.paths = Module._nodeModulePaths(path.dirname(full));
  loaded.require = (id) => {
    if (id.startsWith("@/")) {
      const base = id.slice(2);
      const candidate = [`${base}.ts`, `${base}.tsx`].find((name) => { try { read(name); return true; } catch { return false; } });
      return load(candidate, cache);
    }
    return require(id);
  };
  cache.set(full, loaded.exports);
  loaded._compile(compiled, full);
  return loaded.exports;
}

const rich = load("lib/richReply.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const Markdown = load("components/MarkdownMessage.tsx").default;
const html = (content, props = {}) => renderToStaticMarkup(React.createElement(Markdown, { content, ...props }));

test("choice marker becomes quick replies and is stripped from the text", () => {
  const out = rich.extractChoices("Lagos or Abuja? Which city?\n[[choices: Lagos | Abuja | **Both** | lagos]]");
  assert.equal(out.text, "Lagos or Abuja? Which city?");
  assert.deepEqual(out.choices, ["Lagos", "Abuja", "Both"]);
  assert.deepEqual(rich.extractChoices("Book it? [[options: Yes, book it | Not yet]]").choices, ["Yes, book it", "Not yet"]);
  assert.equal(rich.extractChoices("[[choices: a | b | c | d | e | f]]").choices.length, rich.MAX_CHOICES, "capped at 4");
});

test("a short list after a final question also gives quick replies, a plain list does not", () => {
  assert.deepEqual(rich.extractChoices("Which branch should I use?\n1. Lekki\n2. Ikeja\n3. Yaba").choices, ["Lekki", "Ikeja", "Yaba"]);
  assert.deepEqual(rich.extractChoices("Here's what I found:\n- Lekki\n- Ikeja").choices, [], "no question, no chips");
  assert.deepEqual(rich.extractChoices("Which one?\n- Lekki is closer to you and opens at 8am. It has parking.\n- Ikeja").choices, [], "long items are not quick replies");
  assert.deepEqual(rich.extractChoices("Just a sentence.").choices, []);
});

test("streaming text never flashes the marker, even half-written", () => {
  assert.equal(rich.visibleReply("Which one?\n[[choices: A | B]]"), "Which one?");
  assert.equal(rich.visibleReply("Which one?\n[[cho"), "Which one?");
  assert.equal(rich.visibleReply("Which one?\n[[choices: A | B"), "Which one?");
  assert.equal(rich.visibleReply("Which one?\n[["), "Which one?");
  assert.equal(rich.visibleReply("See [[wiki"), "See [[wiki", "other double brackets stay");
  assert.equal(rich.visibleReply("Read [the docs](https://x.y) now"), "Read [the docs](https://x.y) now");
});

test("follow-ups parse from JSON, fenced JSON or lines, deduped and capped at 3", () => {
  assert.deepEqual(rich.parseFollowUps('["Compare prices", "compare prices", "Show me directions", "Save it", "Fourth"]'), ["Compare prices", "Show me directions", "Save it"]);
  assert.deepEqual(rich.parseFollowUps('```json\n{"suggestions":["Book a table"]}\n```'), ["Book a table"]);
  assert.deepEqual(rich.parseFollowUps("1. Remind me tomorrow\n2. Email Ada"), ["Remind me tomorrow", "Email Ada"]);
  assert.deepEqual(rich.parseFollowUps("[]"), []);
  assert.deepEqual(rich.parseFollowUps("Summary."), [], "junk gives nothing");
  assert.deepEqual(rich.parseFollowUps('["Plan my day", "Book it"]', ["plan my day"]), ["Book it"], "never echoes the user's own message");
});

test("long answers with two or more headings split into sections; code headings are ignored", () => {
  const long = `Short answer: go with the Pro plan.\n\n## Pricing\n${"Costs explained. ".repeat(30)}\n\n## Limits\n${"Limits explained. ".repeat(30)}\n\n\`\`\`bash\n# not a heading\necho hi\n\`\`\``;
  const split = rich.splitSections(long);
  assert.equal(split.lead, "Short answer: go with the Pro plan.");
  assert.deepEqual(split.sections.map((item) => item.title), ["Pricing", "Limits"]);
  assert.match(split.sections[1].body, /# not a heading/);
  assert.equal(rich.splitSections("## A\nshort\n## B\nshort"), null, "short replies stay flat");
  assert.equal(rich.splitSections(`## Only one\n${"x ".repeat(600)}`), null, "one heading is not worth folding");
  const bold = rich.splitSections(`Intro.\n\n**Pros**\n${"good ".repeat(120)}\n\n**Cons**\n${"bad ".repeat(120)}`);
  assert.deepEqual(bold.sections.map((item) => item.title), ["Pros", "Cons"], "bold label lines count as headings");
});

test("table helpers: separator alignment, numeric cells and wide content", () => {
  assert.deepEqual(rich.tableAlignments([":---", ":---:", "---:", "---"]), ["left", "center", "right", undefined]);
  for (const value of ["12", "1,204", "45.6%", "₦2,500", "$12.50", "3-1", "7/10", "-4"]) assert.ok(rich.isNumericCell(value), value);
  for (const value of ["Arsenal", "", "12 goals in 3 games", "v2 beta"]) assert.ok(!rich.isNumericCell(value), value);
  assert.ok(rich.hasWideContent("| a | b |\n|---|---|\n| 1 | 2 |"));
  assert.ok(rich.hasWideContent("```js\nx\n```"));
  assert.ok(!rich.hasWideContent("plain | pipe"));
});

test("tables render for phones: pinned row headers, numeric columns right-aligned", () => {
  const out = html("| Player | Goals | Assists | xG |\n|---|---|---|---|\n| Bruno | 8 | 11 | 6.4 |\n| Rashford | 5 | 3 | 7.1 |");
  assert.match(out, /class="markdown-table-wrap"/);
  assert.match(out, /<th scope="col">Player<\/th>/);
  assert.match(out, /<th scope="row">Bruno<\/th>/, "first column is a row header");
  assert.match(out, /<td style="text-align:right" class="num">8<\/td>/);
  assert.match(out, /data-cols="4"/);
  const css = read("app/v5-richchat.css");
  assert.match(css, /tr > :first-child \{[^}]*position: sticky; left: 0;/, "first column sticks while the table scrolls");
  assert.match(css, /\.markdown-table-wrap \{[^}]*overflow-x: auto/);
  assert.match(css, /\.markdown-table-wrap\.more \{[^}]*mask-image/, "edge fade hints there is more to the right");
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.el-bubble\.assistant:has\(\.markdown-table-wrap/, "table bubbles take the full width");
  assert.match(read("components/MarkdownMessage.tsx"), /ResizeObserver/, "scroll state follows the bubble width");
});

test("code blocks get a 44px copy button, also while a fence is still streaming", () => {
  const out = html("Run this:\n```bash\nnpm test\n```\nThen done.");
  assert.match(out, /<button type="button" class="markdown-copy" aria-label="Copy bash">/);
  assert.match(out, /<pre><code>npm test<\/code><\/pre>/);
  assert.match(out, /Then done\./);
  assert.match(html("```py\nprint(1)"), /<pre><code>print\(1\)<\/code><\/pre>/, "unclosed fence renders as code");
  const css = read("app/v5-richchat.css");
  assert.match(css, /\.markdown-copy \{[^}]*min-height: var\(--tap, 44px\)/);
  assert.match(read("components/MarkdownMessage.tsx"), /execCommand\("copy"\)/, "clipboard fallback for older browsers");
});

test("collapsible sections: first open, rest folded, all open while streaming", () => {
  const long = `Answer first.\n\n## One\n${"alpha ".repeat(90)}\n\n## Two\n${"beta ".repeat(90)}`;
  const folded = html(long, { collapsible: true });
  assert.equal((folded.match(/aria-expanded="true"/g) || []).length, 1);
  assert.equal((folded.match(/aria-expanded="false"/g) || []).length, 1);
  assert.match(folded, /class="el-md-section-body" id="[^"]+" hidden=""/);
  assert.match(folded, /<p>Answer first\.<\/p>/);
  assert.equal((html(long, { collapsible: true, streaming: true }).match(/aria-expanded="true"/g) || []).length, 2);
  assert.doesNotMatch(html(long), /el-md-section/, "screens that don't opt in stay flat");
  assert.doesNotMatch(html("Pick one\n[[choices: A | B]]"), /choices/, "markers never render");
});

test("chat shows quick replies or follow-up chips under the latest reply only", () => {
  const chat = read("components/chat/ChatView.tsx");
  const chips = read("components/chat/ReplyChips.tsx");
  assert.match(chat, /<MarkdownMessage content=\{message\.content\} collapsible streaming=\{message\.status === "streaming"\} \/>/);
  assert.match(chat, /message\.key === lastAssistantKey && message\.status === "done" && !busy && message\.choices\?\.length \? <ReplyChips kind="choices"/);
  assert.match(chat, /!message\.choices\?\.length && message\.followUps\?\.length \? <ReplyChips kind="followups" items=\{message\.followUps\.slice\(0, 3\)\}/);
  assert.match(chat, /choices: stringList\(meta\.choices\)/, "chips survive a reload");
  assert.match(chips, /role="group" aria-label=\{label\}/);
  assert.match(read("app/v5-richchat.css"), /\.el-reply-chip \{[^}]*min-height: var\(--tap, 44px\)/);
  assert.match(read("app/layout.tsx"), /import "\.\/v5-richchat\.css";/);
});

test("agent: output format in the prompt, choices parsed server-side, cheap follow-ups", () => {
  const agent = read("lib/assistant/agent.ts");
  const followups = read("lib/assistant/followups.ts");
  assert.match(agent, /\[\[choices: Option A \| Option B \| Option C\]\]/);
  assert.match(agent, /one "## " heading per section/);
  assert.match(agent, /extractChoices\(reply\.trim\(\)\)/);
  assert.match(agent, /wantFollowUps = !choices\.length && !approvals\.length && !connect\.length && code\.mode !== "code" && !options\.channel/);
  assert.match(followups, /route: \{ tier: "fast" \}/, "follow-ups use the fast tier");
  assert.match(followups, /TIMEOUT_MS = 6_000/, "and never hold the reply for long");
  assert.match(read("lib/assistant/telegram.ts"), /Reply with: \$\{turn\.choices\.join\(" \/ "\)\}/, "Telegram gets choices as text");
});

test("Sources card from #55/#56 is untouched", () => {
  assert.match(read("components/chat/Cards.tsx"), /SourcesCard/);
  assert.match(read("components/chat/SourcesCard.tsx"), /el-site-icon/);
  assert.match(read("app/layout.tsx"), /import "\.\/v4-sources\.css";/);
});
