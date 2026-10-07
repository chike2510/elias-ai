import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = (await readFile(path.join(repositoryRoot, "app/globals.css"), "utf8"))
  .replace(/^@import[^\n]*\n/, "");

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

function fixtureHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${css}</style>
</head>
<body>
  <div class="el-shell el-shell-chat">
    <div class="el-main">
      <header class="el-topbar"><button class="el-icon-btn" aria-label="Open chat history">≡</button><div class="el-topbar-title">Elias</div><a class="el-icon-btn" href="#new" aria-label="New chat">+</a></header>
      <div class="el-content">
        <main class="el-chat">
          <div class="el-thread"><div class="el-thread-inner"></div></div>
          <form class="el-composer"><div class="el-composer-box">
            <textarea rows="1" placeholder="Message Elias"></textarea>
            <button type="submit" class="el-send" aria-label="Send" disabled>↑</button>
          </div></form>
        </main>
      </div>
      <nav class="el-tabbar"><a href="#chat" class="active">Chat</a><a href="#tasks">Tasks</a><a href="#you">You</a></nav>
    </div>
  </div>
  <pre id="layout" aria-hidden="true"></pre>
  <script>
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      };
      const style = getComputedStyle(document.querySelector(".el-composer-box"));
      const tabs = [...document.querySelectorAll(".el-tabbar a")].map((tab) => { const b = tab.getBoundingClientRect(); return { width: b.width, height: b.height }; });
      const layout = {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        composer: rect(".el-composer-box"),
        border: { left: parseFloat(style.borderLeftWidth), right: parseFloat(style.borderRightWidth), top: parseFloat(style.borderTopWidth), bottom: parseFloat(style.borderBottomWidth) },
        tabbar: rect(".el-tabbar"),
        tabs,
        controls: { input: rect(".el-composer textarea"), send: rect(".el-send"), menu: rect(".el-topbar .el-icon-btn") }
      };
      document.querySelector("#layout").textContent = JSON.stringify(layout);
    }));
  </script>
</body>
</html>`;
}

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

test("360px mobile chat keeps Send inside the composer, 44px targets and a 3-tab bar", { skip: chromium ? false : "Chromium is unavailable; set CHROME_BIN to run the rendered-layout regression." }, async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "elias-chat-composer-"));
  const profileDirectory = path.join(temporaryDirectory, "profile");
  await mkdir(profileDirectory);
  const fixturePath = path.join(temporaryDirectory, "composer.html");
  await writeFile(fixturePath, fixtureHtml());

  const browser = spawn(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank"
  ], { detached: process.platform !== "win32", stdio: "ignore" });
  let cdp;

  try {
    const activePortPath = path.join(profileDirectory, "DevToolsActivePort");
    const devToolsPort = await waitFor(async () => {
      const contents = await readFile(activePortPath, "utf8").catch(() => "");
      const port = Number(contents.split(/\r?\n/)[0]);
      return Number.isInteger(port) && port > 0 ? port : null;
    }, "Chromium DevTools port");

    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`).catch(() => null);
      if (!response?.ok) return null;
      return (await response.json()).find((page) => page.type === "page");
    }, "Chromium page target");

    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 800,
      deviceScaleFactor: 2,
      mobile: true
    });
    await cdp.send("Page.navigate", { url: pathToFileURL(fixturePath).href });

    const layout = await waitFor(async () => {
      const response = await cdp.send("Runtime.evaluate", {
        expression: 'document.querySelector("#layout")?.textContent || ""',
        returnByValue: true
      });
      const text = response.result?.result?.value;
      return text ? JSON.parse(text) : null;
    }, "rendered composer geometry");

    assert.equal(layout.viewport.width, 360, "the regression runs at the screenshot's CSS viewport width");
    assert.equal(layout.viewport.dpr, 2, "the viewport emulates the screenshot's 2x device-pixel ratio");

    const composerInner = {
      left: layout.composer.left + layout.border.left,
      right: layout.composer.right - layout.border.right,
      top: layout.composer.top + layout.border.top,
      bottom: layout.composer.bottom - layout.border.bottom
    };
    const send = layout.controls.send;
    assert.ok(send.left >= composerInner.left - 0.5, `Send left edge ${send.left} must be inside composer border ${composerInner.left}`);
    assert.ok(send.right <= composerInner.right + 0.5, `Send right edge ${send.right} must be inside composer border ${composerInner.right}`);
    assert.ok(send.top >= composerInner.top - 0.5, `Send top edge ${send.top} must be inside composer border ${composerInner.top}`);
    assert.ok(send.bottom <= composerInner.bottom + 0.5, `Send bottom edge ${send.bottom} must be inside composer border ${composerInner.bottom}`);

    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const { input, menu } = layout.controls;
    assert.ok(!overlaps(input, send), "the message field and Send must not overlap at 360px");
    assert.ok(input.left < send.left, "Send sits after the message field");
    assert.ok(send.width >= 44 && send.height >= 44, `Send is a 44px tap target (got ${send.width}x${send.height})`);
    assert.ok(menu.width >= 44 && menu.height >= 44, "top bar buttons are 44px tap targets");
    assert.equal(layout.tabs.length, 3, "the bottom bar has exactly three tabs");
    for (const tab of layout.tabs) assert.ok(tab.height >= 44 && tab.width >= 100, "each tab is a comfortable tap target");
    assert.ok(layout.composer.bottom <= layout.tabbar.top + 0.5, "the composer sits above the tab bar");
    assert.ok(layout.tabbar.bottom <= layout.viewport.height + 0.5, "the tab bar stays on screen");
  } finally {
    cdp?.socket.close();
    if (browser.pid) {
      const browserExited = new Promise((resolve) => browser.once("exit", resolve));
      try {
        if (process.platform === "win32") browser.kill("SIGTERM");
        else process.kill(-browser.pid, "SIGTERM");
      } catch {
        // The browser may already have exited after a startup failure.
      }
      await Promise.race([browserExited, delay(1_000)]);
      try {
        if (process.platform === "win32") browser.kill("SIGKILL");
        else process.kill(-browser.pid, "SIGKILL");
      } catch {
        // The browser may have exited during the graceful shutdown window.
      }
      await Promise.race([browserExited, delay(1_000)]);
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9 || !["EBUSY", "ENOTEMPTY"].includes(error.code)) throw error;
        await delay(100);
      }
    }
  }
});
