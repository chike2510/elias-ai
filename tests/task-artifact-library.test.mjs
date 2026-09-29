import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/taskArtifactLibrary.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { syncTaskArtifactToLibrary } = loaded.exports;

test("task artifact sync stores complete text output with stable Library provenance", async () => {
  const records = [];
  const paths = [];
  const saved = await syncTaskArtifactToLibrary(
    { id: "task_fixture", conversationId: "chat_fixture" },
    { id: "artifact_fixture", name: "brief.md", type: "text/markdown; charset=utf-8", createdAt: 1234, preview: "Short summary" },
    {
      fetcher: async (path, options) => {
        paths.push({ path, options });
        return new Response("# Full report\n\nVerified fixture content.", { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
      },
      save: async (record) => records.push(record),
    },
  );

  assert.equal(records.length, 1);
  assert.equal(saved.id, "task_task_fixture_artifact_fixture");
  assert.equal(saved.taskId, "task_fixture");
  assert.equal(saved.conversationId, "chat_fixture");
  assert.equal(saved.text, "# Full report\n\nVerified fixture content.");
  assert.equal(await saved.blob.text(), saved.text);
  assert.equal(saved.summary, "Short summary");
  assert.equal(paths[0].path, "/api/tasks/task_fixture/artifact/artifact_fixture");
  assert.equal(paths[0].options.cache, "no-store");
});

test("failed artifact downloads are not written to the Library", async () => {
  let saveCalled = false;
  await assert.rejects(() => syncTaskArtifactToLibrary(
    { id: "task_missing" },
    { id: "artifact_missing", name: "missing.txt", type: "text/plain" },
    {
      fetcher: async () => new Response("not found", { status: 404 }),
      save: async () => { saveCalled = true; },
    },
  ), /HTTP 404/);
  assert.equal(saveCalled, false);
});

test("binary PDF outputs remain complete Blobs for Library preview and download", async () => {
  const expected = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x66, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65);
  let saved;
  saved = await syncTaskArtifactToLibrary(
    { id: "task_pdf" },
    { id: "artifact_pdf", name: "brief.pdf", type: "application/pdf", createdAt: 4321 },
    {
      fetcher: async () => new Response(expected, { status: 200, headers: { "content-type": "application/pdf" } }),
      save: async (record) => { saved = record; },
    },
  );
  assert.equal(saved.name, "brief.pdf");
  assert.equal(saved.type, "application/pdf");
  assert.equal(saved.text, undefined);
  assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), expected);
  assert.equal(saved.size, expected.length);
});

test("Library sync retries temporary HTTP and storage failures, but writes one stable record", async () => {
  let downloads = 0;
  let writes = 0;
  const waits = [];
  let stored;
  const saved = await syncTaskArtifactToLibrary(
    { id: "task_retry", conversationId: "chat_retry" },
    { id: "artifact_retry", name: "calculator.ts", type: "text/typescript; charset=utf-8" },
    {
      maxRetries: 2,
      retryDelayMs: 10,
      wait: async (milliseconds) => waits.push(milliseconds),
      fetcher: async () => {
        downloads += 1;
        if (downloads === 1) return new Response("temporarily unavailable", { status: 503 });
        return new Response("export const add = (a: number, b: number): number => a + b;", { status: 200, headers: { "content-type": "text/typescript; charset=utf-8" } });
      },
      save: async (record) => {
        writes += 1;
        if (writes === 1) throw new Error("temporary IndexedDB failure");
        stored = record;
      },
    },
  );

  assert.equal(downloads, 2);
  assert.equal(writes, 2);
  assert.deepEqual(waits, [10, 10]);
  assert.equal(saved.id, "task_task_retry_artifact_retry");
  assert.equal(stored.id, saved.id);
  assert.equal(saved.name, "calculator.ts");
  assert.match(saved.text, /number/);
});
