/* Integration test for the assistant core against a Postgres + mock OpenAI-compatible server.
   Run: POSTGRES_URL=... ELIAS_AGENT_BASE_URL=http://127.0.0.1:5599 ELIAS_AGENT_PROVIDERS=custom npx tsx scripts/test-assistant.ts */
import assert from "node:assert/strict";
import { decideApproval, getMessages, listApprovals, runTurn } from "@/lib/assistant/agent";
import { listMemories, memoryContext, searchMemories } from "@/lib/assistant/memory";
import { claimDueSchedules, finishScheduleRun, listSchedules, nextRun } from "@/lib/assistant/schedules";
import { ready } from "@/lib/assistant/db";

const user = `test_${Date.now()}`;

async function main() {
  // schedule maths
  const after = new Date("2026-10-06T18:00:00Z");
  assert.equal(nextRun({ type: "daily", time: "08:00" }, "Africa/Lagos", after)?.toISOString(), "2026-10-07T07:00:00.000Z");
  assert.equal(nextRun({ type: "weekly", days: [1], time: "09:30" }, "Africa/Lagos", after)?.toISOString(), "2026-10-12T08:30:00.000Z");
  assert.equal(nextRun({ type: "daily", time: "08:00" }, "America/New_York", new Date("2026-11-01T05:00:00Z"))?.toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(nextRun({ type: "once", at: "2020-01-01T00:00:00Z" }, "UTC", after), null);

  const t1 = await runTurn({ userId: user, text: "please remember I live in Port Harcourt" });
  assert.match(t1.reply, /OK after 1 tool/);
  const mems = await listMemories(user);
  assert.ok(mems.some((m) => m.content.includes("Port Harcourt")), "memory_save stored");
  assert.ok(mems.some((m) => m.source === "auto"), "auto extraction stored");
  assert.ok((await searchMemories(user, "where does he live port harcourt")).length >= 1);
  assert.match(await memoryContext(user, "flights"), /window seats/);

  const t2 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "what do you know" });
  assert.match(t2.reply, /memory: true/);
  assert.equal(t2.conversationId, t1.conversationId);

  const t3 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "every morning brief me" });
  const schedules = await listSchedules(user);
  assert.equal(schedules.length, 1);
  const db = await ready();
  await db`update public.elias_schedules set next_run_at = now() - interval '1 minute' where user_id = ${user}`;
  const due = await claimDueSchedules(10);
  assert.ok(due.some((d) => d.userId === user));
  assert.equal((await claimDueSchedules(10)).filter((d) => d.userId === user).length, 0, "claim is exclusive");
  await finishScheduleRun(due.find((d) => d.userId === user)!, "done", t3.conversationId);
  assert.ok((await listSchedules(user))[0].nextRunAt, "rescheduled");

  const t4 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "email bola hello" });
  assert.equal(t4.approvals.length, 1);
  assert.equal(t4.approvals[0].tool, "gmail_send");
  const t5 = await decideApproval({ userId: user, approvalId: t4.approvals[0].id, decision: "approve" });
  assert.match(t5.reply, /Follow-up/);
  const approvals = await listApprovals(user, t1.conversationId);
  assert.equal(approvals[0].status, "failed", "gmail without connection fails cleanly");
  await assert.rejects(decideApproval({ userId: user, approvalId: t4.approvals[0].id, decision: "approve" }), /no longer pending/);

  const t6 = await runTurn({ userId: user, text: "text tool please" });
  assert.match(t6.reply, /OK after 1 tool/);

  const msgs = await getMessages(user, t1.conversationId);
  console.log("messages", msgs.length, msgs.map((m) => m.role).join(","));
  console.log("ALL PASSED");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
