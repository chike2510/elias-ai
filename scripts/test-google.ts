/* Integration test for Google against Postgres and the in-memory Google mock:
   tokens are stored encrypted (refresh token never in plaintext), refresh + the 7-day invalid_grant expiry flip the row to expired,
   the chat then shows a Reconnect Google card instead of an error, the brief degrades with a reconnect card, and disconnect revokes.
   Run: POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npx tsx scripts/test-google.ts */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ready } from "@/lib/assistant/db";
import { decryptSecret } from "@/lib/assistant/crypto";
import { disconnectGoogle, exchangeGoogleCode, gmailTriage, googleConnection, setGoogleFetch } from "@/lib/assistant/google";
import { createMockGoogle } from "@/lib/assistant/googleMock";
import { gatherBrief, briefConnect } from "@/lib/assistant/brief";
import { runTurn } from "@/lib/assistant/agent";

process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ELIAS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.ELIAS_DISABLE_JOB_KICK = "1";

/** Scripted model: with tools offered and no tool result yet, calls gmail_triage; then answers with the tool output's start. */
const systems: string[] = [];
function startModel(): Promise<number> {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || "{}") as { messages: Array<{ role: string; content: string }>; tools?: unknown[]; stream?: boolean };
    if (data.tools) systems.push(data.messages[0].content);
    const last = data.messages[data.messages.length - 1];
    const message = !data.tools ? { role: "assistant", content: '{"facts":[]}' } : last.role !== "tool"
      ? { role: "assistant", content: null, tool_calls: [{ id: "g1", type: "function", function: { name: "gmail_triage", arguments: "{}" } }] }
      : { role: "assistant", content: `Tool said: ${String(last.content).slice(0, 80)}` };
    if (!data.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message }] })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const calls = (message as { tool_calls?: Array<Record<string, unknown>> }).tool_calls;
    if (calls) calls.forEach((call, index) => send({ tool_calls: [{ index, ...call }] })); else send({ content: message.content });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function main() {
  const user = `google_${Date.now()}`;
  const db = await ready();
  const mock = createMockGoogle({
    email: "me@example.com", codeTokens: { access: "access-code", refresh: "refresh-SECRET-123" },
    messages: [{ id: "m1", threadId: "t1", from: "Ada <ada@example.com>", to: "me@example.com", subject: "Can you call me?", body: "Please call when free" }],
  });
  setGoogleFetch(mock.fetch);

  // 1. OAuth callback exchange stores both tokens encrypted.
  const request = new Request("https://elias.test/api/connect/google/callback?code=abc&state=s");
  const exchanged = await exchangeGoogleCode(request, "abc", user);
  assert.deepEqual([exchanged.email, exchanged.refreshToken], ["me@example.com", true]);
  const row = (await db`select access_token, refresh_token, status, connected_at from public.elias_oauth_tokens where user_id = ${user} and provider = 'google'`)[0];
  assert.ok(row, "token row written");
  const stored = String(row.refresh_token);
  assert.ok(!stored.includes("refresh-SECRET-123"), "refresh token is not stored in plaintext");
  assert.ok(stored.startsWith("v2:"), "refresh token uses the v2 AES-256-GCM format (ELIAS_ENCRYPTION_KEY)");
  assert.equal(decryptSecret(stored), "refresh-SECRET-123", "and decrypts back");
  assert.ok(!String(row.access_token).includes("access-code") && String(row.access_token).startsWith("v2:"), "access token encrypted too");
  assert.equal(row.status, "ok");
  assert.ok(row.connected_at, "connected_at set (7-day testing clock)");
  const exchangeCall = mock.state.calls.find((call) => call.url.includes("/token"))!;
  assert.match(exchangeCall.body || "", /redirect_uri=https%3A%2F%2Felias\.test%2Fapi%2Fconnect%2Fgoogle%2Fcallback/);
  const connection = await googleConnection(user);
  assert.equal(connection?.status, "ok");
  assert.ok(connection?.renewBy && new Date(connection.renewBy).getTime() - Date.now() > 6.9 * 86400_000, "renewBy ~7 days out in testing mode");
  console.log("encrypted token storage checks passed");

  // 2. Access token expired → refresh → new access token stored encrypted; refresh token kept.
  await db`update public.elias_oauth_tokens set expires_at = now() - interval '1 minute' where user_id = ${user} and provider = 'google'`;
  const triage = await gmailTriage(user, {});
  assert.equal(triage.needsReply[0]?.id, "m1");
  const refreshed = (await db`select access_token, refresh_token from public.elias_oauth_tokens where user_id = ${user} and provider = 'google'`)[0];
  assert.equal(decryptSecret(String(refreshed.access_token)), "access-r1");
  assert.equal(decryptSecret(String(refreshed.refresh_token)), "refresh-SECRET-123");
  assert.ok(String(refreshed.access_token).startsWith("v2:"));

  // 3. Chat while connected: the prompt says connected and the triage card shows.
  process.env.ELIAS_AGENT_BASE_URL = `http://127.0.0.1:${await startModel()}`;
  process.env.ELIAS_AGENT_PROVIDERS = "custom";
  process.env.ELIAS_AGENT_FAST_MODEL = "mock-fast";
  process.env.ELIAS_AGENT_STRONG_MODEL = "mock-strong";
  const ok = await runTurn({ userId: user, text: "check my email" });
  assert.match(systems.at(-1)!, /GOOGLE: connected as me@example.com/);
  assert.ok(ok.cards.some((card) => card.kind === "emails"), "triage card");
  assert.equal(ok.connect.length, 0);

  // 4. The 7-day testing expiry: refresh fails with invalid_grant → row flips to expired → reconnect card, not an error.
  mock.state.refresh = "invalid_grant";
  await db`update public.elias_oauth_tokens set expires_at = now() - interval '1 minute' where user_id = ${user} and provider = 'google'`;
  const expiredTurn = await runTurn({ userId: user, text: "check my email" });
  assert.deepEqual(expiredTurn.connect.map((item) => [item.provider, item.reconnect, item.reason]), [["google", true, "expired"]]);
  assert.equal((await googleConnection(user))?.status, "expired");
  assert.match(expiredTurn.reply, /Reconnect Google/);
  // Next turn knows up front: prompt says expired, tool short-circuits without calling Google.
  const calls = mock.state.calls.length;
  const again = await runTurn({ userId: user, text: "check my email" });
  assert.match(systems.at(-1)!, /access expired/);
  assert.equal(again.connect[0]?.reconnect, true);
  assert.equal(mock.state.calls.length, calls, "no Google calls while expired");

  // 5. The morning brief degrades with a reconnect card.
  const brief = await gatherBrief(user, "Africa/Lagos", "Lagos");
  assert.equal(brief.google, false);
  assert.equal(brief.googleState, "reconnect");
  assert.equal(briefConnect(brief)?.reconnect, true);

  // 6. Reconnecting clears the expired state.
  mock.state.refresh = "ok";
  await exchangeGoogleCode(request, "abc2", user);
  assert.equal((await googleConnection(user))?.status, "ok");

  // 7. Disconnect revokes at Google and deletes our copy.
  await disconnectGoogle(user);
  assert.deepEqual(mock.state.revoked, ["refresh-SECRET-123"]);
  assert.equal(await googleConnection(user), null);
  const rls = await db`select relrowsecurity from pg_class where relname = 'elias_oauth_tokens'`;
  console.log(`google lifecycle checks passed (RLS on elias_oauth_tokens: ${rls[0]?.relrowsecurity})`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
