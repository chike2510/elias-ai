import assert from "node:assert/strict";
import test from "node:test";
import { isTaskOwnedBy, filterTasksForOwner } from "../lib/taskOwnership.ts";
import { createExtensionToken, verifyExtensionToken } from "../lib/extensionAuth.ts";

test("task ownership matches only the exact non-empty authenticated user ID", () => {
  const task = { ownerUserId: "user-a" };
  assert.equal(isTaskOwnedBy(task, "user-a"), true);
  assert.equal(isTaskOwnedBy(task, "user-b"), false);
  assert.equal(isTaskOwnedBy(task, ""), false);
  assert.equal(isTaskOwnedBy(task, undefined), false);
});

test("legacy tasks without owner metadata fail closed", () => {
  assert.equal(isTaskOwnedBy({ id: "legacy-task" }, "user-a"), false);
  assert.equal(isTaskOwnedBy(null, "user-a"), false);
  assert.equal(isTaskOwnedBy(undefined, "user-a"), false);
});

test("task list filtering excludes other users and ownerless legacy records", () => {
  const tasks = [
    { id: "a-1", ownerUserId: "user-a" },
    { id: "b-1", ownerUserId: "user-b" },
    { id: "legacy" },
    { id: "a-2", ownerUserId: "user-a" },
  ];
  assert.deepEqual(filterTasksForOwner(tasks, "user-a").map((task) => task.id), ["a-1", "a-2"]);
  assert.deepEqual(filterTasksForOwner(tasks, undefined), []);
});

test("signed extension token yields its stable owner subject", () => {
  const session = { userId: "user-a", login: "synthetic", createdAt: Date.now() };
  const token = createExtensionToken(session);
  assert.equal(verifyExtensionToken(token)?.sub, "user-a");
});

test("extension token rejects tampering, expiry, and blank subjects", () => {
  const session = { userId: "user-a", login: "synthetic", createdAt: Date.now() };
  const token = createExtensionToken(session);
  const last = token.at(-1);
  const tampered = `${token.slice(0, -1)}${last === "a" ? "b" : "a"}`;
  assert.equal(verifyExtensionToken(tampered), null);
  assert.equal(verifyExtensionToken(createExtensionToken(session, -1)), null);
  assert.equal(verifyExtensionToken(createExtensionToken({ ...session, userId: " " })), null);
});

test("production extension auth refuses the development fallback secret", () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    sessionSecret: process.env.ELIAS_SESSION_SECRET,
    extensionSecret: process.env.ELIAS_EXTENSION_SECRET,
  };
  try {
    process.env.NODE_ENV = "development";
    delete process.env.ELIAS_SESSION_SECRET;
    delete process.env.ELIAS_EXTENSION_SECRET;
    const devToken = createExtensionToken({ userId: "user-a", login: "synthetic", createdAt: Date.now() });
    process.env.NODE_ENV = "production";
    assert.throws(() => createExtensionToken({ userId: "user-a", login: "synthetic", createdAt: Date.now() }), /must be configured/);
    assert.equal(verifyExtensionToken(devToken), null);
  } finally {
    if (saved.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.nodeEnv;
    if (saved.sessionSecret === undefined) delete process.env.ELIAS_SESSION_SECRET; else process.env.ELIAS_SESSION_SECRET = saved.sessionSecret;
    if (saved.extensionSecret === undefined) delete process.env.ELIAS_EXTENSION_SECRET; else process.env.ELIAS_EXTENSION_SECRET = saved.extensionSecret;
  }
});
