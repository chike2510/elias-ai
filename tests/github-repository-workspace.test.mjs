import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
function loadTypeScript(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const workspace = loadTypeScript(path.resolve("lib/githubRepositoryWorkspace.ts"));

test("repository paths reject traversal, absolute paths, and excluded generated folders", () => {
  assert.equal(workspace.safeRepositoryPath("src/components/App.tsx"), "src/components/App.tsx");
  for (const pathValue of ["../secrets.txt", "src/../../x.ts", "/etc/passwd", "node_modules/pkg/index.js", ".git/config"]) assert.equal(workspace.safeRepositoryPath(pathValue), null, pathValue);
  assert.equal(workspace.validRepositoryPart("octo-owner"), true);
  assert.equal(workspace.validRepositoryPart("../other"), false);
});

test("repository hydration excludes live environment files and bounds project text files", async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  const repositoryTree = [
    { path: ".env", type: "blob", size: 30 },
    { path: ".env.production", type: "blob", size: 30 },
    { path: ".env.example", type: "blob", size: 30 },
    { path: "README.md", type: "blob", size: 30 },
    { path: "src/main.ts", type: "blob", size: 30 },
    { path: "node_modules/lib/index.js", type: "blob", size: 30 },
    { path: "secret.pem", type: "blob", size: 30 },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    if (url.pathname === "/repos/acme/widget") return Response.json({ full_name: "acme/widget", default_branch: "main", private: true, html_url: "https://github.com/acme/widget" });
    if (url.pathname === "/repos/acme/widget/git/ref/heads/main") return Response.json({ object: { sha: "a".repeat(40) } });
    if (url.pathname === `/repos/acme/widget/git/trees/${"a".repeat(40)}`) return Response.json({ truncated: false, tree: repositoryTree });
    if (url.pathname.includes("/contents/")) {
      const name = decodeURIComponent(url.pathname.split("/contents/")[1]);
      return Response.json({ type: "file", encoding: "base64", content: Buffer.from(`content for ${name}`, "utf8").toString("base64") });
    }
    throw new Error(`Unexpected mocked GitHub URL: ${url}`);
  };
  try {
    const result = await workspace.loadGitHubRepositoryWorkspace("mock-token", "acme", "widget");
    assert.equal(result.repository.fullName, "acme/widget");
    assert.equal(result.repository.branch, "main");
    assert.equal(result.repository.commitSha, "a".repeat(40));
    assert.equal(result.repository.private, true);
    assert.deepEqual(result.files.map((file) => file.path).sort(), [".env.example", "README.md", "src/main.ts"]);
    assert.equal(requested.some((url) => url.includes("/contents/.env?")), false);
    assert.equal(requested.some((url) => url.includes(".env.production")), false);
    assert.equal(requested.some((url) => url.includes("node_modules")), false);
    assert.ok(requested.some((url) => new URL(url).pathname === "/repos/acme/widget/git/ref/heads/main"));
    assert.ok(requested.some((url) => new URL(url).pathname === `/repos/acme/widget/git/trees/${"a".repeat(40)}`));
    assert.ok(requested.filter((url) => new URL(url).pathname.includes("/contents/")).every((url) => new URL(url).searchParams.get("ref") === "a".repeat(40)));
  } finally { globalThis.fetch = previousFetch; }
});

test("repository branch selection rejects traversal before making any network request", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    await assert.rejects(() => workspace.loadGitHubRepositoryWorkspace("mock-token", "acme", "widget", "../../private"), /valid repository branch/i);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("repository hydration marks unreadable eligible files as a partial snapshot", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/repos/acme/widget") return Response.json({ full_name: "acme/widget", default_branch: "main", html_url: "https://github.com/acme/widget" });
    if (url.pathname === "/repos/acme/widget/git/ref/heads/main") return Response.json({ object: { sha: "a".repeat(40) } });
    if (url.pathname === `/repos/acme/widget/git/trees/${"a".repeat(40)}`) return Response.json({ truncated: false, tree: [{ path: "README.md", type: "blob", size: 20 }, { path: "src/main.ts", type: "blob", size: 20 }] });
    if (url.pathname.endsWith("/contents/README.md")) return Response.json({ type: "file", encoding: "base64", content: Buffer.from("readme", "utf8").toString("base64") });
    if (url.pathname.endsWith("/contents/src/main.ts")) return Response.json({ message: "Not Found" }, { status: 404 });
    throw new Error(`Unexpected mocked GitHub URL: ${url}`);
  };
  try {
    const result = await workspace.loadGitHubRepositoryWorkspace("mock-token", "acme", "widget");
    assert.equal(result.files.length, 1);
    assert.equal(result.truncated, true);
  } finally { globalThis.fetch = previousFetch; }
});

test("changed-file calculation reports added, modified, and deleted paths deterministically", () => {
  const result = workspace.changedRepositoryFiles(
    [{ path: "keep.ts", content: "same" }, { path: "edit.ts", content: "old" }, { path: "delete.ts", content: "gone" }],
    [{ path: "keep.ts", content: "same" }, { path: "edit.ts", content: "new" }, { path: "add.ts", content: "fresh" }],
  );
  assert.deepEqual(result.map(({ path: file, status }) => [file, status]), [["add.ts", "added"], ["delete.ts", "deleted"], ["edit.ts", "modified"]]);
  assert.deepEqual(result[0], { path: "add.ts", status: "added", after: "fresh" });
  assert.deepEqual(result[1], { path: "delete.ts", status: "deleted", before: "gone" });
  assert.deepEqual(result[2], { path: "edit.ts", status: "modified", before: "old", after: "new" });
});
