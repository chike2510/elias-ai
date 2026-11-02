import { after } from "next/server";
import type { ToolSchema } from "@/lib/assistant/llm";
import type { ToolContext } from "@/lib/assistant/tools";
import { blockedBy } from "@/lib/browserRun/core";
import { createRun, updateRun } from "@/lib/browserRun/store";
import { runInNode, startWorkerRun, workerConfigured } from "@/lib/browserRun/runner";

type Args = Record<string, unknown>;
type Tool = { schema: ToolSchema["function"]; needsApproval?: (args: Args, ctx: ToolContext) => Promise<string | null> | string | null; run: (args: Args, ctx: ToolContext) => Promise<unknown> };

const str = (value: unknown) => typeof value === "string" ? value.trim() : "";

function appUrl() {
  if (process.env.ELIAS_APP_URL) return process.env.ELIAS_APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export const BROWSER_RUN_TOOLS: Record<string, Tool> = {
  browser_task: {
    schema: {
      name: "browser_task",
      description: "Hand a multi-step website job to Elias's own browser agent (sign-ups, long forms, multi-page flows). It runs in the background with a live view card: it looks at screenshots, clicks and types, fills saved logins from the vault by reference, asks the user before pressing Submit/Pay/Send/Create account, pauses for captchas and phone codes, and reads email codes from Gmail. Returns at once; the card shows progress. Prefer browser_open for a quick look at one page.",
      parameters: { type: "object", properties: { goal: { type: "string", description: "What to get done, with every detail the agent needs (names, choices, which saved login to use)." }, start_url: { type: "string", description: "http(s) URL to start on" } }, required: ["goal", "start_url"] },
    },
    run: async (args, ctx) => {
      const goal = str(args.goal);
      const startUrl = str(args.start_url);
      if (!goal) throw new Error("goal is required.");
      if (!/^https?:\/\//i.test(startUrl)) throw new Error("start_url must be an http(s) URL.");
      const blocked = blockedBy(startUrl, (process.env.ELIAS_BROWSER_BLOCKLIST || "").split(","));
      if (blocked) throw new Error(`${blocked} is on the blocked-sites list, so Elias won't drive it.`);
      const run = await createRun({ userId: ctx.userId, conversationId: ctx.conversationId, goal, startUrl, runner: workerConfigured() ? "worker" : "node" });
      if (workerConfigured()) {
        try { await startWorkerRun(run, appUrl()); }
        catch (error) {
          await updateRun(run.id, { status: "failed", statusText: "Couldn't start", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      } else {
        after(() => runInNode(run.id));
      }
      ctx.addCard?.({ kind: "browser_run", id: run.id, goal, startUrl });
      return { run_id: run.id, status: "started", tell_user: "The browser job is running; the live card shows each step. It will ask in the card before pressing Submit/Pay/Send/Create account, and for any captcha or code." };
    },
  },
};
