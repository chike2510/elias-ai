import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function loadWorker(clients = []) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const posted = [];
  const self = {
    location: { origin: "https://elias.test" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); }, pushManager: {} },
    clients: {
      matchAll: async () => clients.map((client) => ({ ...client, postMessage: (message) => posted.push(message), focus: async () => { client.focused = true; }, navigate: async (url) => { client.navigated = url; } })),
      openWindow: async (url) => { opened.push(url); },
      claim: async () => undefined,
    },
    skipWaiting: () => undefined,
  };
  vm.runInNewContext(source, { self, caches: {}, fetch: async () => ({}), URL, Promise });
  return { listeners, shown, opened, posted };
}

async function fire(listener, event) {
  let pending;
  listener({ ...event, waitUntil: (promise) => { pending = promise; } });
  await pending;
}

test("push shows a notification with the target url and tells open tabs", async () => {
  const worker = loadWorker([{ url: "https://elias.test/" }]);
  await fire(worker.listeners.push, { data: { json: () => ({ title: "Done: Research", body: "Glover Court", url: "/chat?id=conv_1", tag: "job-1", type: "jobs" }) } });
  assert.equal(worker.shown[0].title, "Done: Research");
  assert.equal(worker.shown[0].options.data.url, "/chat?id=conv_1");
  assert.equal(worker.shown[0].options.tag, "job-1");
  assert.deepEqual(JSON.parse(JSON.stringify(worker.posted[0])), { type: "elias:push", url: "/chat?id=conv_1", kind: "jobs" });
});

test("push ignores off-site urls", async () => {
  const worker = loadWorker();
  await fire(worker.listeners.push, { data: { json: () => ({ title: "x", url: "https://evil.example" }) } });
  assert.equal(worker.shown[0].options.data.url, "/");
});

test("notificationclick opens the conversation, reusing an open tab", async () => {
  const tab = { url: "https://elias.test/tasks" };
  const worker = loadWorker([tab]);
  let closed = false;
  await fire(worker.listeners.notificationclick, { notification: { close: () => { closed = true; }, data: { url: "/chat?id=conv_9" } } });
  assert.ok(closed);
  assert.equal(tab.navigated, "https://elias.test/chat?id=conv_9");
  const empty = loadWorker([]);
  await fire(empty.listeners.notificationclick, { notification: { close: () => undefined, data: { url: "/chat?id=conv_9" } } });
  assert.deepEqual([...empty.opened], ["https://elias.test/chat?id=conv_9"]);
});
