import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.resolve("app/globals.css"), "utf8");
const component = readFileSync(path.resolve("components/StructuredChatResponse.tsx"), "utf8");

function blockFor(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`unterminated CSS block for ${selector}`);
}

function property(block, name) {
  return block.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "m"))?.[1]?.trim();
}

function luminance(hex) {
  const rgb = hex.replace("#", "").match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("structured prose is isolated in the intended response card while plain replies stay unchanged", () => {
  assert.match(component, /if \(!hasStructure\) return <MarkdownMessage content=\{content\} taskId=\{taskId\} \/>/);
  assert.match(component, /<div className="assistant-answer-card">\s*<MarkdownMessage content=\{content\} taskId=\{taskId\} \/>\s*<\/div>/);
});

test("answer and recommendation surfaces use restrained, bounded glass with opaque fallbacks", () => {
  for (const selector of [".assistant-answer-card", ".assistant-recommendation-card"]) {
    const rule = blockFor(css, selector);
    assert.match(rule, /background-color:\s*#[\da-f]{6}/i, `${selector} needs an opaque fallback`);
    assert.match(rule, /border:\s*1px solid/);
    const blur = Number(rule.match(/backdrop-filter:\s*blur\((\d+)px\)/)?.[1]);
    assert.ok(blur >= 4 && blur <= 10, `${selector} blur should stay subtle (4–10px), got ${blur}`);
  }
});

test("suggested replies stay crisp, high contrast, comfortably tappable, and keyboard visible", () => {
  const rule = blockFor(css, ".assistant-reply-choices > div button");
  const foreground = property(rule, "color");
  const background = property(rule, "background");
  assert.match(foreground, /^#[\da-f]{6}$/i);
  assert.match(background, /^#[\da-f]{6}$/i, "reply buttons should remain opaque, not frosted");
  assert.ok(contrast(foreground, background) >= 4.5, "reply text must meet WCAG AA contrast for normal text");
  assert.match(rule, /min-height:\s*44px/);
  const focus = blockFor(css, ".assistant-reply-choices > div button:focus-visible");
  assert.match(focus, /outline:\s*2px solid/);
  assert.match(focus, /outline-offset:\s*3px/);
});

test("mobile choices stay full-width and reduced-motion preferences remain honored", () => {
  const mobile = blockFor(css, "@media (max-width: 600px)");
  assert.match(mobile, /\.assistant-reply-choices > div\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(mobile, /\.assistant-reply-choices button\s*\{[^}]*width:\s*100%/s);
  const reducedMotion = blockFor(css, "@media (prefers-reduced-motion: reduce)");
  assert.match(reducedMotion, /transition-duration:\s*\.01ms\s*!important/);
});
