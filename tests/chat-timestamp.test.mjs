import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatChatTimestamp } from "../lib/chatTimestamp.mjs";

const chatScreen = readFileSync(path.resolve("components/chat/ChatView.tsx"), "utf8");
const css = readFileSync(path.resolve("app/globals.css"), "utf8");

test("chat timestamps use viewer-local time and retain an ISO datetime value", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    const createdAt = Date.parse("2026-01-02T00:05:00.000Z");
    const date = new Date(createdAt);
    const timestamp = formatChatTimestamp(createdAt);
    const localLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    const utcLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(date);

    assert.deepEqual(timestamp, { label: localLabel, dateTime: "2026-01-02T00:05:00.000Z" });
    assert.notEqual(timestamp.label, utcLabel, "display time should follow the viewer's local zone rather than UTC");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("valid epoch timestamps render while absent, nonnumeric, and out-of-range legacy values are omitted", () => {
  assert.deepEqual(formatChatTimestamp(0), {
    label: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(0)),
    dateTime: "1970-01-01T00:00:00.000Z",
  });

  for (const createdAt of [undefined, null, "1767312300000", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.equal(formatChatTimestamp(createdAt), null, `unexpected timestamp for ${String(createdAt)}`);
  }
});

test("every persisted chat message uses an accessible timestamp with responsive styling", () => {
  assert.match(chatScreen, /function MessageTimestamp\(\{ createdAt \}: \{ createdAt: unknown \}\)/);
  assert.match(chatScreen, /<time className="el-stamp" dateTime=\{timestamp\.dateTime\}>\{timestamp\.label\}<\/time>/);
  assert.match(chatScreen, /<MessageTimestamp createdAt=\{message\.createdAt\} \/>/);

  const rule = css.match(/\.el-stamp\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "timestamp styles should be present");
  assert.match(rule, /display:\s*block/);
  assert.match(rule, /font-size:\s*11px/);
  assert.match(rule, /font-variant-numeric:\s*tabular-nums/);
  assert.doesNotMatch(rule, /white-space:\s*nowrap|position:\s*absolute/);
  assert.match(css, /\.el-row\.user \.el-stamp\s*\{[^}]*text-align:\s*right/s);
});
