import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function load(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const router = load(path.resolve("lib/assistant/modelRouter.ts"));
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("model choice parsing keeps provider/model ids with slashes and rejects junk", () => {
  assert.deepEqual(router.parseChoice(undefined), { mode: "auto" });
  assert.deepEqual(router.parseChoice("fast"), { mode: "fast" });
  assert.deepEqual(router.parseChoice("strong"), { mode: "strong" });
  assert.deepEqual(router.parseChoice("groq/openai/gpt-oss-120b"), { mode: "specific", provider: "groq", model: "openai/gpt-oss-120b" });
  assert.deepEqual(router.parseChoice("gemini/gemini-3.8-flash"), { mode: "specific", provider: "gemini", model: "gemini-3.8-flash" });
  assert.deepEqual(router.parseChoice("evil/model"), { mode: "auto" });
  assert.deepEqual(router.parseChoice("groq/has space"), { mode: "auto" });
  assert.equal(router.choiceId(router.parseChoice("github/openai/gpt-4.1")), "github/openai/gpt-4.1");
});

test("auto router: fast for plain chat, strong for tools/long/files/tool steps, vision for images", () => {
  assert.equal(router.chooseTier({ text: "hey, how are you?" }), "fast");
  assert.equal(router.chooseTier({ text: "check my email please" }), "strong");
  assert.equal(router.chooseTier({ text: "remind me every morning to stretch" }), "strong");
  assert.equal(router.chooseTier({ text: "open https://example.com" }), "strong");
  assert.equal(router.chooseTier({ text: "x".repeat(500) }), "strong");
  assert.equal(router.chooseTier({ text: "hi", files: 1 }), "strong");
  assert.equal(router.chooseTier({ text: "hi", step: 1 }), "strong");
  assert.equal(router.chooseTier({ text: "hi", usedTool: true }), "strong");
  assert.equal(router.chooseTier({ text: "hi", images: 2 }), "vision");
});

test("resolveRoute honours overrides but images always need vision", () => {
  assert.deepEqual(router.resolveRoute({ mode: "fast" }, { text: "check my email" }), { tier: "fast" });
  assert.deepEqual(router.resolveRoute({ mode: "strong" }, { text: "hi" }), { tier: "strong" });
  assert.deepEqual(router.resolveRoute({ mode: "fast" }, { text: "hi", images: 1 }), { tier: "vision" });
  assert.deepEqual(router.resolveRoute({ mode: "specific", provider: "groq", model: "llama-3.1-8b-instant" }, { text: "hi" }), { tier: "fast", provider: "groq", model: "llama-3.1-8b-instant" });
});

test("attachments are validated, capped and stored without full-size images", () => {
  assert.deepEqual(router.sanitizeAttachments(undefined), { attachments: [] });
  assert.match(router.sanitizeAttachments("nope").error, /list/);
  assert.match(router.sanitizeAttachments([{ kind: "image", dataUrl: "https://example.com/x.png" }]).error, /couldn't be read/);
  assert.match(router.sanitizeAttachments([{ kind: "exe" }]).error, /Unknown/);
  const five = Array.from({ length: 5 }, () => ({ kind: "image", name: "a.png", dataUrl: pixel }));
  assert.match(router.sanitizeAttachments(five).error, /up to 4 images/);
  const ok = router.sanitizeAttachments([{ kind: "image", name: "a<b>.png", size: 68, dataUrl: pixel, thumb: pixel }, { kind: "file", name: "n.txt", text: "hello", size: 5 }]);
  assert.equal(ok.error, undefined);
  assert.equal(ok.attachments[0].name, "ab.png");
  assert.equal(ok.attachments[0].mime, "image/png");
  const stored = router.toStored(ok.attachments);
  assert.equal(stored[0].dataUrl, undefined);
  assert.equal(stored[0].thumb, pixel);
  assert.equal(stored[1].text, "hello");
});

test("file context caps each document and the total", () => {
  const block = router.fileContext([{ name: "a.txt", text: "a".repeat(100), chars: 100 }, { name: "b.txt", text: "b".repeat(100), chars: 100 }], 60, 90);
  assert.match(block, /\[Attached file: a\.txt \(first 60 of 100 characters\)\]/);
  assert.match(block, /\[Attached file: b\.txt \(first 30 of 100 characters\)\]/);
  assert.match(router.fileContext([{ name: "scan.pdf", text: "" }]), /No readable text/);
});

test("model label for the reply footer", () => {
  assert.deepEqual(router.modelLabel("groq/openai/gpt-oss-120b"), { provider: "groq", model: "gpt-oss-120b" });
  assert.deepEqual(router.modelLabel("openrouter/meta-llama/llama-4-maverick:free"), { provider: "openrouter", model: "llama-4-maverick" });
  assert.equal(router.modelLabel(undefined), null);
});

test("llm.ts wires Gemini after Groq with the current models first, and vision order groq > github > openrouter > gemini", () => {
  const source = readFileSync(path.resolve("lib/assistant/llm.ts"), "utf8");
  assert.match(source, /DEFAULT_ORDER = "custom,groq,gemini,cerebras/);
  assert.match(source, /GEMINI_MODELS = \["gemini-3\.8-flash", "gemini-3\.5-flash-lite", "gemini-3\.1-flash-lite", "gemini-2\.5-flash", "gemini-2\.5-flash-lite", "gemini-2\.0-flash"\]/);
  assert.match(source, /VISION_ORDER: AgentProvider\[\] = \["custom", "groq", "github", "openrouter", "gemini"\]/);
  assert.match(source, /generativelanguage\.googleapis\.com\/v1beta\/openai/);
});

test("composer has attach, mic and model picker; reply has read aloud and model label", () => {
  const view = readFileSync(path.resolve("components/chat/ChatView.tsx"), "utf8");
  const tools = readFileSync(path.resolve("components/chat/ComposerTools.tsx"), "utf8");
  for (const name of ["AttachMenu", "AttachmentStrip", "MicButton", "ModelSheet", "ReplyMeta"]) assert.match(view, new RegExp(`<${name}`));
  assert.match(tools, /speechSynthesis/);
  assert.match(tools, /via \{label\.provider\} · \{label\.model\}/);
  assert.match(tools, /capture="environment"/);
});
