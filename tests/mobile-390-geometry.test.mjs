import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { appCss, screens } from "./fixtures/mobile-screens.mjs";

// 390px pass: every fixture screen (same markup and classes as the TSX) must fit a 390px phone
// in light and dark: no horizontal overflow, 44px tap targets, and text at least 3:1 against its surface.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = appCss(repositoryRoot);
const probe = await readFile(path.join(repositoryRoot, "tests/fixtures/mobile-probe.js"), "utf8");

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // Try the next executable name.
    }
  }
  return null;
}

const chromium = findChromium();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(readValue, description, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await readValue();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message);
  };
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chromium DevTools call timed out: ${method}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { socket, send };
}


const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;

test("fixture screens cover the main mobile surfaces", () => {
  for (const name of ["tasks-home", "workbench-start", "workbench-task", "you", "chats", "memory", "chat-cards"]) assert.ok(screens[name], `missing fixture ${name}`);
  assert.match(css, /\.v5-wb-focus/, "app CSS is loaded in layout order, including v5-polish.css");
});

test("390px screens fit, keep 44px targets and readable text in light and dark", { skip: chromium ? false : "Chromium is unavailable; set CHROME_BIN to run the rendered-layout regression." }, async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "elias-mobile-390-"));
  const profileDirectory = path.join(temporaryDirectory, "profile");
  await mkdir(profileDirectory);
  const browser = spawn(chromium, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, "about:blank"], { detached: process.platform !== "win32", stdio: "ignore" });
  let cdp;
  try {
    const devToolsPort = await waitFor(async () => {
      const contents = await readFile(path.join(profileDirectory, "DevToolsActivePort"), "utf8").catch(() => "");
      const port = Number(contents.split(/\r?\n/)[0]);
      return Number.isInteger(port) && port > 0 ? port : null;
    }, "Chromium DevTools port", 30_000);
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`).catch(() => null);
      if (!response?.ok) return null;
      return (await response.json()).find((item) => item.type === "page");
    }, "Chromium page target");
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    const problems = [];
    const backgrounds = {};
    for (const [name, body] of Object.entries(screens)) {
      const file = path.join(temporaryDirectory, `${name}.html`);
      await writeFile(file, page(body));
      for (const scheme of ["light", "dark"]) {
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
        await cdp.send("Page.navigate", { url: `${pathToFileURL(file).href}?${scheme}` });
        const result = await waitFor(async () => {
          const response = await cdp.send("Runtime.evaluate", { expression: `document.readyState === "complete" ? ${probe} : null`, returnByValue: true });
          return response.result?.result?.value || null;
        }, `${name} (${scheme}) layout`);
        backgrounds[scheme] = result.background;
        assert.equal(result.width, 390, "the regression runs at a 390px CSS viewport");
        if (result.scrollWidth > 390) problems.push(`${name} ${scheme}: page scrolls sideways (${result.scrollWidth}px)`);
        for (const item of result.overflow) problems.push(`${name} ${scheme}: overflows ${item}`);
        for (const item of result.targets) problems.push(`${name} ${scheme}: small tap target ${item}`);
        for (const item of result.contrast) problems.push(`${name} ${scheme}: low contrast ${item}`);
      }
    }
    assert.notEqual(backgrounds.light, backgrounds.dark, "dark mode switches the theme tokens");
    assert.deepEqual(problems, []);
  } finally {
    cdp?.socket.close();
    if (browser.pid) {
      const exited = new Promise((resolve) => browser.once("exit", resolve));
      try { if (process.platform === "win32") browser.kill("SIGKILL"); else process.kill(-browser.pid, "SIGKILL"); } catch { /* already gone */ }
      await Promise.race([exited, delay(1_000)]);
    }
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
});
