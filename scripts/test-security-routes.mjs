import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 3217;
const base = `http://127.0.0.1:${port}`;
const testSecret = "security-route-integration-test-secret-32-bytes";
const preload = fileURLToPath(new URL("./security-test-fetch-mock.cjs", import.meta.url));
const nextCli = resolve(root, "node_modules/next/dist/bin/next");
const env = {
  ...process.env,
  ELIAS_SESSION_SECRET: testSecret,
  EXA_API_KEY: "test-only-no-live-provider-calls",
  GITHUB_TOKEN: "test-only-server-token-must-not-be-used",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(" "),
};
const server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env,
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });

function sessionCookie() {
  const session = {
    userId: "security-test-user",
    login: "security-test-user",
    createdAt: Date.now(),
  };
  const key = createHash("sha256").update(testSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const encode = (value) => Buffer.from(value).toString("base64url");
  return [iv, cipher.getAuthTag(), encrypted].map((part) => encode(part.toString("base64url"))).join(".");
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next dev server exited (${server.exitCode}).\n${stderr}`);
    try {
      const response = await fetch(`${base}/api/auth/me`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(500);
  }
  throw new Error(`Next dev server did not become ready.\n${stderr}`);
}

async function post(path, body, cookie) {
  const headers = cookie ? { cookie: `elias_session=${cookie}` } : {};
  if (body instanceof FormData) return fetch(`${base}${path}`, { method: "POST", headers, body });
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

try {
  await waitForServer();
  const anonymousForm = new FormData();
  anonymousForm.append("file", new Blob(["hello"]), "hello.txt");
  const deniedExtract = await post("/api/documents/extract", anonymousForm);
  assert.equal(deniedExtract.status, 401, "anonymous document extraction must be denied");
  const deniedSearch = await post("/api/web/search", { query: "test query" });
  assert.equal(deniedSearch.status, 401, "anonymous web search must be denied");
  const deniedOpen = await post("/api/web/open", { url: "https://elias-test.invalid/article" });
  assert.equal(deniedOpen.status, 401, "anonymous web opening must be denied");

  const cookie = sessionCookie();
  const fileForm = new FormData();
  fileForm.append("file", new Blob(["signed-in extraction fixture"]), "fixture.txt");
  const extracted = await post("/api/documents/extract", fileForm, cookie);
  assert.equal(extracted.status, 200, "signed-in extraction should succeed");
  const extractedBody = await extracted.json();
  assert.equal(extractedBody.text, "signed-in extraction fixture");
  for (let index = 0; index < 4; index += 1) {
    const additionalForm = new FormData();
    additionalForm.append("file", new Blob(["quota fixture"]), `quota-${index}.txt`);
    assert.equal((await post("/api/documents/extract", additionalForm, cookie)).status, 200);
  }
  const overQuotaForm = new FormData();
  overQuotaForm.append("file", new Blob(["over quota"]), "over-quota.txt");
  const overQuota = await post("/api/documents/extract", overQuotaForm, cookie);
  assert.equal(overQuota.status, 429, "the per-user extraction quota should be enforced");
  assert.ok(Number(overQuota.headers.get("retry-after")) > 0, "429 should include Retry-After");

  const search = await post("/api/web/search", { query: "signed-in fixture query" }, cookie);
  assert.equal(search.status, 200, "signed-in web search should succeed");
  const searchBody = await search.json();
  assert.equal(searchBody.results?.[0]?.title, "Security test fixture");

  const opened = await post("/api/web/open", { url: "https://elias-test.invalid/article" }, cookie);
  assert.equal(opened.status, 200, "signed-in source opening should succeed");
  const openedBody = await opened.json();
  assert.match(openedBody.content, /Public test article content/);

  const publicRepo = await fetch(`${base}/api/github/repo?url=${encodeURIComponent("https://github.com/octocat/Hello-World")}`);
  assert.equal(publicRepo.status, 200, "public GitHub metadata lookup should remain available");
  const repoBody = await publicRepo.json();
  assert.equal(repoBody.private, false);
  assert.equal(repoBody.defaultBranch, "main", "the optional server-level token must not be applied");

  const invalidRepo = await fetch(`${base}/api/github/repo?url=${encodeURIComponent("https://evilgithub.com/octocat/Hello-World")}`);
  assert.equal(invalidRepo.status, 400, "non-GitHub hosts must be rejected");

  console.log("Security route integration tests passed (external provider calls mocked).");
} finally {
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => server.once("exit", resolveExit)), delay(5_000)]);
}
