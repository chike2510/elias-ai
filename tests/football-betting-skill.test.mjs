import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/assistant/skills/footballBetting.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("../lib/assistant/agent.ts", import.meta.url), "utf8");

test("football betting skill: full playbook text is shipped", () => {
  for (const part of ["Module A: Match Shots Analysis", "Module G: Bet Builder Construction", "PASS — insufficient evidence or inadequate price.", "Final Quality-Control Checklist", "Never sacrifice analytical quality merely to produce a bet."]) assert.ok(src.includes(part), part);
  assert.match(src, /request_go_ahead/);
  assert.match(src, /browser_login/);
});

test("football betting skill: injected into the chat system prompt and starts on the strong tier", () => {
  assert.match(agent, /footballBettingActive\(options\.text/);
  assert.match(agent, /extra: \[codeExtra, bettingSkill, options\.extraContext\]/);
  assert.match(agent, /let forceStrong = bettingActive/);
});
