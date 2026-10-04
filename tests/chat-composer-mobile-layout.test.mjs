import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const css = readFileSync(path.resolve("app/globals.css"), "utf8");
const chatSource = readFileSync(path.resolve("components/screens/ChatScreen.tsx"), "utf8");
const chatSourceFile = ts.createSourceFile("ChatScreen.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function lastRuleBlock(selector) {
  const start = css.lastIndexOf(selector);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}" && --depth === 0) return css.slice(open + 1, index);
  }
  assert.fail(`unterminated CSS block for ${selector}`);
}

function px(block, property) {
  const value = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m"))?.[1]?.trim();
  assert.ok(value, `missing ${property} declaration`);
  const match = value.match(/^(\d+(?:\.\d+)?)px(?:\s*!important)?$/);
  assert.ok(match, `expected ${property} in pixels, got ${value}`);
  return Number(match[1]);
}

function jsxClassName(node) {
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null;
  const attribute = opening?.attributes.properties.find((item) =>
    ts.isJsxAttribute(item) && item.name.getText(chatSourceFile) === "className"
  );
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function findJsxWithClassName(node, className) {
  if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && jsxClassName(node) === className) {
    return node;
  }
  let match = null;
  ts.forEachChild(node, (child) => {
    if (!match) match = findJsxWithClassName(child, className);
  });
  return match;
}

test("mobile composer places voice after attachments and before send", () => {
  const bar = findJsxWithClassName(chatSourceFile, "chat-composer-bar");
  assert.ok(bar, "chat composer toolbar must exist");
  const directChildren = bar.children.filter((child) =>
    !ts.isJsxText(child) || child.getText(chatSourceFile).trim() !== ""
  );

  assert.equal(directChildren.length, 3, "toolbar should contain the left group, voice control, and send action");
  assert.equal(jsxClassName(directChildren[0]), "composer-left", "attachment control stays on the left");
  assert.ok(findJsxWithClassName(directChildren[0], "composer-plus"), "left group retains the add/attachment control");
  assert.equal(jsxClassName(directChildren[1]), "composer-utility", "microphone is a trailing toolbar control");
  const send = findJsxWithClassName(directChildren[2], "chat-send");
  assert.ok(send, "send control follows the microphone");
  assert.ok(directChildren[1].end <= send.pos, "microphone must appear immediately before the send action");
});

test("mobile composer text clears every overlay at the screenshot's CSS viewport", () => {
  const rasterWidth = 720;
  const devicePixelRatio = 2;
  const cssViewportWidth = rasterWidth / devicePixelRatio;
  assert.equal(cssViewportWidth, 360, "720 raster pixels at 2x DPR correspond to a 360px CSS viewport");
  assert.ok(cssViewportWidth <= 700, "the screenshot-sized viewport must activate the mobile layout");

  // Read the higher-specificity direct-child rule that wins the real CSS cascade.
  const input = lastRuleBlock(".chat-route-screen .chat-composer > .chat-composer-input");
  const padding = input.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/m)?.[1].trim().split(/\s+/);
  assert.equal(padding?.length, 4, "mobile input needs explicit four-sided padding");
  const top = Number.parseFloat(padding[0]);
  const right = Number.parseFloat(padding[1]);
  const bottom = Number.parseFloat(padding[2]);
  const left = Number.parseFloat(padding[3]);
  assert.deepEqual([top, right, bottom, left], [15, 90, 7, 56]);

  const bar = lastRuleBlock(".chat-route-screen .chat-composer-bar");
  const barInset = Number(bar.match(/inset:\s*0\s+(\d+)px/)?.[1]);
  assert.ok(Number.isFinite(barInset), "overlay control bar must define its horizontal inset");
  const barGapRule = css.match(/\.chat-route-screen \.chat-composer-bar\s*\{[^}]*?\bgap:\s*(\d+(?:\.\d+)?)px[^}]*\}/m);
  assert.ok(barGapRule, "overlay control bar must define its control gap");
  const barGap = Number(barGapRule[1]);
  const addButton = px(lastRuleBlock(".chat-route-screen .composer-plus"), "width");
  const voiceButton = px(lastRuleBlock(".chat-route-screen .composer-utility"), "width");
  const sendButton = px(lastRuleBlock(".chat-route-screen .chat-send"), "width");

  assert.ok(left >= barInset + addButton + 8, "placeholder must clear the left attachment control with breathing room");
  assert.ok(right >= barInset + sendButton + barGap + voiceButton + 8, "placeholder must clear both trailing voice and send controls");
  assert.ok(cssViewportWidth - 24 - 2 - left - right >= 180, "the screenshot-sized viewport must retain at least 180px of editable text width");
  assert.ok(320 - 24 - 2 - left - right >= 140, "a 320px viewport must retain at least 140px of editable text width");
});
