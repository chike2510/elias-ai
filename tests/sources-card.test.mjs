import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const read = (file) => readFileSync(path.resolve(file), "utf8");
const sourcePath = path.resolve("components/chat/SourcesCard.tsx");
const component = read("components/chat/SourcesCard.tsx");
const css = read("app/v4-sources.css");
const cards = read("components/chat/Cards.tsx");
const research = read("components/screens/ResearchScreen.tsx");
const layout = read("app/layout.tsx");

function load() {
  const compiled = ts.transpileModule(component, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.require = (id) => ({ "react/jsx-runtime": { jsx: () => null, jsxs: () => null }, react: {}, "lucide-react": {} })[id] ?? {};
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const { domainLetter, chipDomains } = load();

test("chips show one letter per unique domain, first three only", () => {
  assert.equal(domainLetter("www.bbc.co.uk"), "B");
  assert.equal(domainLetter("en.wikipedia.org"), "W");
  assert.equal(domainLetter("github.com"), "G");
  assert.equal(domainLetter(""), "?");
  assert.equal(domainLetter("punchng.com"), "P");
  assert.equal(domainLetter("nairametrics.com.ng"), "N");
  assert.deepEqual(chipDomains(["www.a.com", "a.com", "b.org", "c.net", "d.io"]), ["a.com", "b.org", "c.net"]);
});

test("sources card is collapsed by default behind an accessible toggle", () => {
  assert.match(component, /useState\(false\)/, "starts collapsed");
  assert.match(component, /<button type="button"[^>]*aria-expanded=\{open\}[^>]*aria-controls=\{panelId\}/);
  assert.match(component, /inert=\{!open\}/, "collapsed rows are out of the tab order");
  assert.match(component, /Globe2/);
  assert.match(component, /ChevronDown/);
  assert.match(component, /el-sources-count/);
  assert.match(component, /chipDomains\(domains\)/);
});

test("toggle is a 44px tap target, animates height and uses theme tokens only", () => {
  assert.match(css, /\.el-sources-toggle \{[^}]*min-height: var\(--tap, 44px\)/);
  assert.match(css, /\.el-sources-panel \{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows/);
  assert.match(css, /\.el-sources\.is-open \.el-sources-panel \{[^}]*grid-template-rows: 1fr/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(/i, "no hard-coded colours, so dark mode follows the tokens");
  assert.match(layout, /import "\.\/v4-sources\.css"/);
});

test("chat link cards and research reports both render through SourcesCard", () => {
  assert.match(cards, /card\.kind === "links"\) return <SourcesCard/);
  assert.ok(research.includes('<SourcesCard variant="inline"'), "research report uses the shared card");
  assert.ok(research.includes("openOnHash={`src-${job.id}-`}"), "citation links still open the list");
  assert.doesNotMatch(research, /<h3>Sources<\/h3>/);
});

test("site icons use real favicons, lazy and sized, with the letter circle as fallback", () => {
  const { faviconUrl, siteHost } = load();
  assert.equal(siteHost("https://www.bbc.co.uk/news?x=1"), "bbc.co.uk");
  assert.equal(siteHost("WWW.GitHub.com"), "github.com");
  assert.equal(faviconUrl("www.github.com"), "https://www.google.com/s2/favicons?domain=github.com&sz=64");
  assert.equal(faviconUrl("https://en.wikipedia.org/wiki/Lagos"), "https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=64");
  assert.equal(faviconUrl(""), "", "no domain, no request");
  assert.equal(faviconUrl("not a domain"), "");
  assert.match(component, /<img ref=\{image\} src=\{src\} alt="" width=\{size\} height=\{size\} loading="lazy"/);
  assert.match(component, /onError=\{\(\) => setFailed\(true\)\}/, "broken image falls back");
  assert.match(component, /naturalWidth <= 16\) setFailed\(true\)/, "Google's 16px default globe falls back too");
  assert.match(component, /\{failed \? domainLetter\(host \|\| domain\) : <img/, "fallback is the existing letter");
  assert.match(component, /<SiteIcon key=\{domain\} domain=\{domain\} size=\{18\} className="el-sources-chip" \/>/, "collapsed chips");
  assert.match(cards, /<SiteIcon domain=\{host\(item\.url\)\} size=\{20\} className="el-favicon" \/>/, "expanded chat rows");
  assert.match(research, /<SiteIcon domain=\{source\.domain \|\| source\.url\}/, "expanded research rows");
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*\.el-site-icon \{ --site-icon-plate: var\(--text\); \}/, "light plate in dark mode");
});
