import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.resolve("app/globals.css"), "utf8");

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

test("mobile chat input clears overlaid controls at the screenshot's CSS viewport", () => {
  const rasterWidth = 720;
  const devicePixelRatio = 2;
  const cssViewportWidth = rasterWidth / devicePixelRatio;
  assert.equal(cssViewportWidth, 360, "720 raster pixels at 2x DPR correspond to a 360px CSS viewport");

  // The input's direct-child rule has higher specificity than the broad mobile selector.
  // Read that rule so a declaration that loses the cascade cannot make this test pass.
  const input = lastRuleBlock(".chat-route-screen .chat-composer > .chat-composer-input");
  const padding = input.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/m)?.[1].trim().split(/\s+/);
  assert.equal(padding?.length, 4, "mobile input needs explicit four-sided padding");
  const top = Number.parseFloat(padding[0]);
  const right = Number.parseFloat(padding[1]);
  const bottom = Number.parseFloat(padding[2]);
  const left = Number.parseFloat(padding[3]);
  assert.deepEqual([top, right, bottom, left], [15, 83, 7, 86]);

  const bar = lastRuleBlock(".chat-route-screen .chat-composer-bar");
  const barInset = Number(bar.match(/inset:\s*0\s+(\d+)px/)?.[1]);
  const addButton = px(lastRuleBlock(".chat-route-screen .composer-plus"), "width");
  const leftGap = px(lastRuleBlock(".chat-route-screen .composer-left"), "gap");
  const voiceButton = px(lastRuleBlock(".chat-route-screen .composer-utility"), "width");
  const sendButton = px(lastRuleBlock(".chat-route-screen .chat-send"), "width");

  assert.ok(left >= barInset + addButton + leftGap + voiceButton + 8, "placeholder must start beyond the add and voice controls with breathing room");
  assert.ok(right >= barInset + sendButton + 8, "input text must end before the send button with breathing room");
  assert.ok(cssViewportWidth - 24 - 2 - left - right >= 150, "the screenshot-sized viewport must retain at least 150px of editable text width");
  assert.ok(320 - 24 - 2 - left - right >= 120, "a 320px viewport must retain at least 120px of editable text width");
});
