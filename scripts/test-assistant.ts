/* Integration test for the assistant core against Postgres + the scripted OpenAI-compatible mock.
   Run:
     node scripts/mock-llm.mjs 5599 &                      # scripted model (streams when asked)
     npx pglite-server --port 5432 &                       # or any Postgres
     POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres ELIAS_AGENT_BASE_URL=http://127.0.0.1:5599 \
       ELIAS_AGENT_PROVIDERS=custom npx tsx scripts/test-assistant.ts */
import assert from "node:assert/strict";
import { decideApproval, getMessages, importConversations, listApprovals, listConversations, runTurn, type TurnEvent } from "@/lib/assistant/agent";
import { listMemories, memoryContext, searchMemories } from "@/lib/assistant/memory";
import { claimDueSchedules, finishScheduleRun, listSchedules, nextRun, setScheduleStatus, updateSchedule } from "@/lib/assistant/schedules";
import { ensureDailyBrief, fallbackBrief, gatherBrief } from "@/lib/assistant/brief";
import { runDueSchedules } from "@/lib/assistant/runner";
import { rateLimit } from "@/lib/assistant/rateLimit";
import { visibleStreamText } from "@/lib/assistant/llm";
import { getModelChoice, setModelChoice } from "@/lib/assistant/models";
import { encrypt, ready } from "@/lib/assistant/db";
import { countSubscriptions, notifyUser, saveSubscription, setPushSender, validSubscription } from "@/lib/assistant/push";
import { setNotifyPrefs } from "@/lib/assistant/userData";
import { advanceJobs, cancelJob, claimJobs, createJob, getJob, listJobs, parseSlice, resumeAfterApproval, runSlice } from "@/lib/assistant/jobs";
import { finishOnboarding, onboardingState, savePreferences, saveProfile, saveRoutine } from "@/lib/assistant/onboarding";

const user = `test_${Date.now()}`;
// Tier-specific models for the custom provider, so the v3 router assertions can see which tier answered.
process.env.ELIAS_AGENT_FAST_MODEL ||= "mock-fast";
process.env.ELIAS_AGENT_VISION_MODEL ||= "mock-vision";
process.env.ELIAS_DISABLE_JOB_KICK = "1";

/* Push is mocked: every send is recorded; endpoints containing "gone" answer 410 like an expired subscription. */
type Sent = { endpoint: string; payload: { title: string; body: string; url: string; type: string } };
const sent: Sent[] = [];
setPushSender(async (subscription, payload) => {
  if (subscription.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
  sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
});
const device = (name: string) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: "BPk3y", auth: "auth-secret" } });

async function main() {
  // schedule maths
  const after = new Date("2026-10-06T18:00:00Z");
  assert.equal(nextRun({ type: "daily", time: "08:00" }, "Africa/Lagos", after)?.toISOString(), "2026-10-07T07:00:00.000Z");
  assert.equal(nextRun({ type: "weekly", days: [1], time: "09:30" }, "Africa/Lagos", after)?.toISOString(), "2026-10-12T08:30:00.000Z");
  assert.equal(nextRun({ type: "daily", time: "08:00" }, "America/New_York", new Date("2026-11-01T05:00:00Z"))?.toISOString(), "2026-11-01T13:00:00.000Z");
  assert.equal(nextRun({ type: "once", at: "2020-01-01T00:00:00Z" }, "UTC", after), null);

  // stream text filter
  assert.equal(visibleStreamText("<think>hmm</think>Hello"), "Hello");
  assert.equal(visibleStreamText("Hi <think>still thinking"), "Hi ");
  assert.equal(visibleStreamText("Hi <tool_c"), "Hi ");

  // streaming: deltas add up to the reply, memory chip is reported
  const events: TurnEvent[] = [];
  const t1 = await runTurn({ userId: user, text: "please remember I live in Port Harcourt", onEvent: (event) => events.push(event) });
  assert.match(t1.reply, /OK after 1 tool/);
  assert.ok(events.some((e) => e.type === "status" && e.label === "Saving to memory…"), "status line for tool");
  assert.equal(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join(""), t1.reply, "streamed text equals reply");
  assert.equal(events[events.length - 1].type, "done");
  assert.ok(t1.memories.some((m) => m.content.includes("Port Harcourt")), "memory chip from memory_save");
  assert.ok(t1.memories.some((m) => m.content.includes("window seats")), "memory chip from auto extraction");
  const stored1 = (await getMessages(user, t1.conversationId)).find((m) => m.role === "assistant")!;
  assert.ok(Array.isArray(stored1.meta.memories) && (stored1.meta.memories as unknown[]).length >= 2, "chips persisted on the message");

  const mems = await listMemories(user);
  assert.ok(mems.some((m) => m.content.includes("Port Harcourt")), "memory_save stored");
  assert.ok(mems.some((m) => m.source === "auto"), "auto extraction stored");
  assert.ok((await searchMemories(user, "where does he live port harcourt")).length >= 1);
  assert.match(await memoryContext(user, "flights"), /window seats/);

  const t2 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "what do you know" });
  assert.match(t2.reply, /memory: true/);
  assert.equal(t2.conversationId, t1.conversationId);

  // schedules
  const t3 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "every morning brief me" });
  assert.equal(t3.cards.find((c) => c.kind === "schedule")?.kind, "schedule", "schedule card");
  const schedules = await listSchedules(user);
  assert.equal(schedules.length, 1);
  const db = await ready();
  await db`update public.elias_schedules set next_run_at = now() - interval '1 minute' where user_id = ${user}`;
  const due = await claimDueSchedules(10, user);
  assert.equal(due.length, 1);
  assert.equal((await claimDueSchedules(10, user)).length, 0, "claim is exclusive");
  await finishScheduleRun(due[0], "done", t3.conversationId);
  assert.ok((await listSchedules(user))[0].nextRunAt, "rescheduled");
  const edited = await updateSchedule(user, schedules[0].id, { time: "07:15" });
  assert.deepEqual(edited?.spec, { type: "daily", time: "07:15" });
  await assert.rejects(updateSchedule(user, schedules[0].id, { time: "25:00" }), /HH:MM/);

  // approvals: exact details, edit before approve (a fake Google token: execution reaches Google and fails cleanly)
  await db`insert into public.elias_oauth_tokens (user_id, provider, email, access_token, expires_at) values (${user}, 'google', 'me@example.com', ${encrypt("fake-token")}, now() + interval '1 hour')`;
  const t4 = await runTurn({ userId: user, conversationId: t1.conversationId, text: "email bola hello" });
  assert.equal(t4.approvals.length, 1);
  assert.equal(t4.approvals[0].tool, "gmail_send");
  assert.deepEqual(t4.approvals[0].details, { kind: "email", to: "bola@example.com", cc: undefined, subject: "Hi", body: "Hello Bola,\n\nAre we still on for Friday?\n\nChikeziri" });
  assert.deepEqual(t4.approvals[0].editable, ["to", "cc", "subject", "body"]);
  const t5 = await decideApproval({ userId: user, approvalId: t4.approvals[0].id, decision: "approve", edits: { subject: "Edited subject", evil: "x" } });
  assert.match(t5.reply, /Follow-up/);
  const approvals = await listApprovals(user, t1.conversationId);
  assert.equal(approvals[0].status, "failed", "gmail with a bad token fails cleanly");
  assert.equal((approvals[0].details as { subject: string }).subject, "Edited subject", "edit applied");
  await assert.rejects(decideApproval({ userId: user, approvalId: t4.approvals[0].id, decision: "approve" }), /no longer pending/);
  const t4b = await runTurn({ userId: user, conversationId: t1.conversationId, text: "invite ada to a sync" });
  assert.equal(t4b.approvals[0].details.kind, "event");
  assert.deepEqual((t4b.approvals[0].details as { guests: string[] }).guests, ["ada@example.com"]);

  // inline connect: a Google tool without a connection produces a connect card, not an error
  await db`delete from public.elias_oauth_tokens where user_id = ${user}`;
  const connectEvents: TurnEvent[] = [];
  const t7 = await runTurn({ userId: user, text: "check my email", onEvent: (event) => connectEvents.push(event) });
  assert.equal(t7.connect[0]?.provider, "google");
  assert.ok(connectEvents.some((e) => e.type === "connect"));
  assert.ok(connectEvents.some((e) => e.type === "status" && e.label === "Reading Gmail…"));

  const t6 = await runTurn({ userId: user, text: "text tool please" });
  assert.match(t6.reply, /OK after 1 tool/);

  // daily brief: seeded once, survives removal, posts into a conversation via the scheduler path
  const briefUser = `${user}_brief`;
  const seeded = await ensureDailyBrief(briefUser, "Africa/Lagos");
  assert.equal(seeded?.kind, "daily_brief");
  assert.deepEqual(seeded?.spec, { type: "daily", time: "08:00" });
  assert.equal(await ensureDailyBrief(briefUser, "Africa/Lagos"), null, "only once");
  assert.equal((await listSchedules(briefUser)).length, 1);
  const data = await gatherBrief(briefUser, "Africa/Lagos");
  assert.equal(data.google, false);
  assert.match(fallbackBrief(data), /Connect Google/);
  await db`update public.elias_schedules set next_run_at = now() - interval '1 minute' where user_id = ${briefUser}`;
  const ran = await runDueSchedules(5, briefUser);
  assert.deepEqual(ran.map((r) => r.ok), [true]);
  const [briefSchedule] = await listSchedules(briefUser);
  assert.ok(briefSchedule.conversationId && briefSchedule.nextRunAt, "brief posted and rescheduled");
  const briefMessages = await getMessages(briefUser, briefSchedule.conversationId!);
  assert.match(briefMessages[briefMessages.length - 1].content, /Morning/);
  console.log("weather in brief:", data.weather ? `${data.weather.place} ${data.weather.summary}` : `unavailable (${data.notes.join("; ")})`);
  await setScheduleStatus(briefUser, briefSchedule.id, "cancelled");
  assert.equal(await ensureDailyBrief(briefUser, "Africa/Lagos"), null, "removed brief is not recreated");
  assert.equal((await listSchedules(briefUser)).length, 0);

  // import from IndexedDB: idempotent
  const local = [
    { id: "chat_local_1", title: "Old chat", createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 3_600_000, messages: [{ role: "user", content: "hi", createdAt: Date.now() - 86_400_000 }, { role: "assistant", content: "hello", createdAt: Date.now() - 86_000_000 }, { role: "system", content: "x" }] },
    { id: "chat_local_empty", title: "Empty", messages: [] },
  ];
  const first = await importConversations(user, local);
  assert.deepEqual(first.imported, ["chat_local_1"]);
  const second = await importConversations(user, local);
  assert.deepEqual(second.imported, []);
  const importedConversation = (await listConversations(user)).find((c) => c.id === first.map.chat_local_1);
  assert.equal(importedConversation?.source, "import");
  assert.equal((await getMessages(user, first.map.chat_local_1)).length, 2, "system message dropped, no duplicates");

  // v3: model router + override, image parts to a vision model, documents as context
  const v1 = await runTurn({ userId: user, text: "which model are you" });
  assert.equal(v1.model, "custom/mock-fast", "short plain chat goes to the fast tier");
  assert.equal(v1.tier, "fast");
  const v2 = await runTurn({ userId: user, conversationId: v1.conversationId, text: "which model, strong please", modelChoice: "strong" });
  assert.equal(v2.tier, "strong");
  assert.equal(v2.model, `custom/${process.env.ELIAS_AGENT_MODEL || "gpt-4.1-mini"}`, "strong override uses the strong list");
  const v3 = await runTurn({ userId: user, conversationId: v1.conversationId, text: "which model, pinned", modelChoice: "custom/mock-pinned" });
  assert.equal(v3.model, "custom/mock-pinned", "a specific provider/model override is tried first");
  assert.match(v3.reply, /model=mock-pinned/);
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const v4 = await runTurn({ userId: user, conversationId: v1.conversationId, text: "what is this", attachments: [{ kind: "image", name: "receipt.jpg", mime: "image/png", size: 68, dataUrl: pixel, thumb: pixel }] });
  assert.equal(v4.tier, "vision");
  assert.equal(v4.model, "custom/mock-vision", "images go to the vision model");
  assert.match(v4.reply, /I can see 1 image\(s\) via mock-vision/);
  // A pinned text-only model can't see images: the mock rejects it (HTTP 400 "model ...") and the vision model takes over.
  const v5 = await runTurn({ userId: user, conversationId: v1.conversationId, text: "and this one", modelChoice: "custom/mock-pinned-text", attachments: [{ kind: "image", name: "a.png", mime: "image/png", size: 68, dataUrl: pixel }] });
  assert.equal(v5.model, "custom/mock-vision", "falls back from a non-vision pinned model");
  const stored = (await getMessages(user, v1.conversationId)).filter((m) => m.role === "user" && Array.isArray(m.meta.attachments));
  assert.equal(stored.length, 2, "attachment metadata stored on the user message");
  const storedImage = (stored[0].meta.attachments as Array<Record<string, unknown>>)[0];
  assert.equal(storedImage.name, "receipt.jpg");
  assert.equal(storedImage.thumb, pixel, "thumbnail kept");
  assert.equal(storedImage.dataUrl, undefined, "full image not stored");
  const v6 = await runTurn({ userId: user, conversationId: v1.conversationId, text: "summarise", attachments: [{ kind: "file", name: "notes.txt", mime: "text/plain", size: 30, text: "Quarterly revenue grew 12 percent.", chars: 34 }] });
  assert.equal(v6.tier, "strong", "documents go to the strong tier");
  assert.match(v6.reply, /Read the file: Quarterly revenue/);
  const assistantMeta = (await getMessages(user, v1.conversationId)).filter((m) => m.role === "assistant").pop()!;
  assert.equal(assistantMeta.meta.model, v6.model, "model label persisted");
  assert.equal(await getModelChoice(user), "auto");
  assert.equal(await setModelChoice(user, "groq/openai/gpt-oss-120b"), "groq/openai/gpt-oss-120b");
  assert.equal(await getModelChoice(user), "groq/openai/gpt-oss-120b");
  assert.equal(await setModelChoice(user, "nonsense/x y"), "auto", "unknown choices fall back to auto");

  // push: send path, 410 pruning, per-type mute
  const pushUser = `${user}_push`;
  assert.equal(validSubscription(device("ok")), true);
  assert.equal(validSubscription({ endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } }), false);
  await saveSubscription(pushUser, device("ok"));
  await saveSubscription(pushUser, device("ok")); // same endpoint twice is one device
  await saveSubscription(pushUser, device("gone"));
  assert.equal(await countSubscriptions(pushUser), 2);
  let outcome = await notifyUser(pushUser, "jobs", { title: "Hello", body: "  spaced\n out  ", url: "/chat?id=x" });
  assert.deepEqual([outcome.sent, outcome.pruned], [1, 1]);
  assert.equal(await countSubscriptions(pushUser), 1, "410 subscription pruned");
  assert.deepEqual(sent[sent.length - 1].payload, { title: "Hello", body: "spaced out", url: "/chat?id=x", type: "jobs" });
  await setNotifyPrefs(pushUser, { jobs: false });
  assert.equal((await notifyUser(pushUser, "jobs", { title: "x", body: "y", url: "/" })).skipped, "muted");
  assert.equal((await notifyUser(`${user}_nodevice`, "jobs", { title: "x", body: "y", url: "/" })).skipped, "no_devices");

  // push on a scheduled run: the daily brief notifies with a link to its conversation
  await ensureDailyBrief(pushUser, "Africa/Lagos");
  await db`update public.elias_schedules set next_run_at = now() - interval '1 minute' where user_id = ${pushUser}`;
  const before = sent.length;
  assert.deepEqual((await runDueSchedules(5, pushUser)).map((r) => r.ok), [true]);
  const briefPush = sent.slice(before).find((item) => item.payload.type === "brief");
  assert.ok(briefPush, "brief push sent");
  assert.equal(briefPush!.payload.title, "Your daily brief");
  assert.equal(briefPush!.payload.url, `/chat?id=${(await listSchedules(pushUser))[0].conversationId}`);
  await setNotifyPrefs(pushUser, { brief: false });
  await db`update public.elias_schedules set next_run_at = now() - interval '1 minute' where user_id = ${pushUser}`;
  const mutedBefore = sent.length;
  await runDueSchedules(5, pushUser);
  assert.equal(sent.length, mutedBefore, "muted brief sends nothing");

  // background jobs
  assert.deepEqual(parseSlice("notes\nSTATUS: CONTINUE\nmore"), { status: "continue", text: "more" });
  assert.deepEqual(parseSlice("Answer first.\nSTATUS: DONE"), { status: "done", text: "Answer first." });
  assert.equal(parseSlice("no marker").status, null);
  const jobUser = `${user}_jobs`;
  await saveSubscription(jobUser, device("jobs-phone"));
  const handoff = await runTurn({ userId: jobUser, text: "please start a background job on suya" });
  assert.ok(handoff.actions.some((a) => a.tool === "start_background_job" && a.ok), "agent tool starts a job");
  let jobs = await listJobs(jobUser);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "queued");
  assert.equal(jobs[0].kind, "research");
  assert.equal(jobs[0].conversationId, handoff.conversationId, "result goes back to the chat it came from");
  assert.ok(!(await listConversations(jobUser)).some((c) => c.kind === "job"), "work conversation hidden from history");
  const claimed = await claimJobs(1, { userId: jobUser });
  assert.equal(claimed.length, 1);
  assert.equal((await claimJobs(1, { userId: jobUser })).length, 0, "lease: a running job can't be claimed twice");
  const slice1 = await runSlice(claimed[0].job, claimed[0].owner);
  assert.deepEqual([slice1.status, slice1.more], ["queued", true]);
  const slice2 = await advanceJobs(1, { userId: jobUser });
  assert.equal(slice2[0].status, "done");
  const doneJob = (await getJob(jobUser, jobs[0].id))!;
  assert.match(doneJob.result || "", /Glover Court/);
  assert.equal(doneJob.slices, 2);
  assert.ok(doneJob.steps.length === 2 && doneJob.steps[0].tools.includes("Checking the time…"), "steps recorded");
  const chatAfter = await getMessages(jobUser, handoff.conversationId);
  assert.match(chatAfter[chatAfter.length - 1].content, /Background job done: \*\*Suya research\*\*[\s\S]*Glover Court/);
  const jobPush = sent.find((item) => item.endpoint.endsWith("jobs-phone") && item.payload.type === "jobs");
  assert.equal(jobPush?.payload.title, "Done: Suya research");
  assert.equal(jobPush?.payload.url, `/chat?id=${handoff.conversationId}`);
  assert.equal((await advanceJobs(1, { userId: jobUser })).length, 0, "finished job is not run again");

  // a job that needs approval pauses, notifies, and resumes after the decision
  await db`insert into public.elias_oauth_tokens (user_id, provider, email, access_token, expires_at) values (${jobUser}, 'google', 'me@example.com', ${encrypt("fake-token")}, now() + interval '1 hour')`;
  const emailJob = await createJob(jobUser, { title: "Email Ada", prompt: "email-task: ask Ada about Friday", kind: "task", announce: true });
  assert.match((await getMessages(jobUser, emailJob.conversationId))[0].content, /On it in the background/);
  assert.equal((await advanceJobs(1, { userId: jobUser }))[0].status, "waiting_approval");
  const waiting = (await getJob(jobUser, emailJob.id))!;
  assert.equal(waiting.approvalIds.length, 1);
  assert.ok(sent.some((item) => item.payload.type === "approvals" && item.payload.title === "Approval needed: Email Ada" && item.payload.url === `/chat?id=${waiting.workConversationId}`), "approval push");
  assert.equal((await advanceJobs(1, { userId: jobUser })).length, 0, "waiting job doesn't run");
  await decideApproval({ userId: jobUser, approvalId: waiting.approvalIds[0], decision: "decline" });
  assert.equal(await resumeAfterApproval(jobUser, waiting.approvalIds[0]), emailJob.id);
  assert.equal((await getJob(jobUser, emailJob.id))!.status, "queued");
  assert.equal((await advanceJobs(1, { userId: jobUser }))[0].status, "done");

  // bounded: a job that never says DONE is finished on its last slice
  const slow = await createJob(jobUser, { title: "Slow", prompt: "slow-task forever" });
  await db`update public.elias_jobs set max_slices = 2 where id = ${slow.id}`;
  assert.equal((await advanceJobs(1, { userId: jobUser }))[0].status, "queued");
  assert.equal((await advanceJobs(1, { userId: jobUser }))[0].status, "done");

  // cancel: queued, and mid-slice (the slice's outcome is discarded)
  const cancelMe = await createJob(jobUser, { title: "Cancel me", prompt: "slow-task" });
  assert.equal((await cancelJob(jobUser, cancelMe.id))?.status, "cancelled");
  assert.equal(await cancelJob(jobUser, cancelMe.id), null, "already cancelled");
  const midway = await createJob(jobUser, { title: "Midway", prompt: "multi-research midway" });
  const [mid] = await claimJobs(1, { jobId: midway.id });
  await cancelJob(jobUser, midway.id);
  assert.equal((await runSlice(mid.job, mid.owner)).status, "cancelled");
  assert.equal((await getJob(jobUser, midway.id))!.status, "cancelled");

  // a slice whose lease expired (function died) is reclaimed; repeated model failures fail the job and notify
  const crash = await createJob(jobUser, { title: "Crash", prompt: "crash-task" });
  const [dead] = await claimJobs(1, { jobId: crash.id });
  assert.ok(dead);
  await db`update public.elias_jobs set lease_until = now() - interval '1 second' where id = ${crash.id}`;
  const [again] = await claimJobs(1, { jobId: crash.id });
  assert.ok(again && again.owner !== dead.owner, "expired lease reclaimed");
  assert.equal((await runSlice(again.job, again.owner)).status, "queued", "first failure retries");
  assert.equal((await advanceJobs(1, { jobId: crash.id }))[0].status, "failed");
  assert.ok(sent.some((item) => item.payload.title === "Job stopped: Crash"));

  // at most 3 active jobs per user
  for (let i = 0; i < 3; i += 1) await createJob(`${user}_limit`, { prompt: `slow-task ${i}` });
  await assert.rejects(createJob(`${user}_limit`, { prompt: "one too many" }), /already have 3/);

  // onboarding
  const newUser = `${user}_new`;
  assert.equal((await onboardingState(newUser)).needed, true);
  assert.equal(await saveProfile(newUser, "  Chike "), "Chike");
  const routine = await saveRoutine(newUser, { timezone: "Africa/Lagos", briefTime: "07:30", city: "Lagos" }).catch((error) => ({ error: (error as Error).message }));
  if ("error" in routine) console.log("onboarding routine skipped (weather lookup offline):", routine.error);
  else {
    const state = await onboardingState(newUser);
    assert.deepEqual([state.timezone, state.briefTime, state.city], ["Africa/Lagos", "07:30", "Lagos"]);
    assert.equal((await listSchedules(newUser)).filter((item) => item.kind === "daily_brief").length, 1);
  }
  await assert.rejects(saveRoutine(newUser, { timezone: "Mars/Base" }), /valid timezone/);
  assert.deepEqual(await savePreferences(newUser, [{ statement: "Prefers short, direct replies." }, { statement: "" }]), ["Prefers short, direct replies."]);
  assert.ok((await listMemories(newUser)).some((m) => m.content === "Prefers to be called Chike."));
  assert.equal((await finishOnboarding(newUser, "complete")).needed, false);

  // rate limiting
  const bucket = `test:${user}`;
  for (let i = 0; i < 3; i += 1) assert.equal((await rateLimit(bucket, 3, 60_000)).ok, true);
  const blocked = await rateLimit(bucket, 3, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);

  const msgs = await getMessages(user, t1.conversationId);
  console.log("messages", msgs.length, msgs.map((m) => m.role).join(","));
  console.log("ALL PASSED");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
