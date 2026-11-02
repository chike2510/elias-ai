import { COLLECT_ELEMENTS, VIEWPORT, type Observation, type PageDriver, type RunAction } from "./core";

/** The slice of the Playwright Page API the loop uses; both playwright-core and @cloudflare/playwright satisfy it. */
export type MinimalPage = {
  url(): string;
  title(): Promise<string>;
  evaluate<R>(expression: string): Promise<R>;
  screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  waitForLoadState(state: "domcontentloaded" | "networkidle", options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  mouse: { move(x: number, y: number, options?: { steps?: number }): Promise<void>; click(x: number, y: number, options?: { delay?: number }): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  keyboard: { type(text: string, options?: { delay?: number }): Promise<void>; press(key: string): Promise<void> };
  selectOption(selector: string, value: string | { label: string }): Promise<unknown>;
};

function toBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Waits for the page to settle: DOM loaded, network mostly idle, then a short beat for animations. */
export async function settle(page: MinimalPage) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

export function pageDriver(page: MinimalPage): PageDriver {
  return {
    async observe(): Promise<Observation> {
      const data = await page.evaluate<{ title: string; elements: Observation["elements"]; text: string; signals: Observation["signals"] }>(COLLECT_ELEMENTS).catch(() => ({ title: "", elements: [], text: "", signals: {} }));
      const shot = await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
      return { url: page.url(), title: data.title || await page.title().catch(() => ""), elements: data.elements, text: data.text, signals: data.signals, ...(shot ? { frame: toBase64(shot) } : {}) };
    },
    async act(action: RunAction) {
      if (action.type === "click" || action.type === "type") {
        await page.mouse.move(action.x, action.y, { steps: 8 });
        await page.mouse.click(action.x, action.y, { delay: 40 });
      }
      if (action.type === "type") {
        await page.keyboard.press("ControlOrMeta+A").catch(() => undefined);
        await page.keyboard.press("Backspace").catch(() => undefined);
        await page.keyboard.type(action.text, { delay: 25 });
        if (action.submit) await page.keyboard.press("Enter");
      } else if (action.type === "select") {
        const selector = `[data-elias-id="${action.target}"]`;
        await page.selectOption(selector, action.value).catch(() => page.selectOption(selector, { label: action.value }));
      } else if (action.type === "scroll") {
        await page.mouse.wheel(0, action.direction === "up" ? -500 : 500);
      } else if (action.type === "navigate") {
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (action.type === "wait") {
        await page.waitForTimeout(Math.min(action.ms, 5_000));
      }
      await settle(page);
    },
    async keepAlive() { await page.title(); },
  };
}

export async function prepare(page: MinimalPage, startUrl: string) {
  await page.setViewportSize(VIEWPORT).catch(() => undefined);
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
}
