import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { googleConfigured, googleConnection } from "@/lib/assistant/google";
import { browserConfigured } from "@/lib/assistant/browser";
import { agentProviders } from "@/lib/assistant/llm";
import { hasDb } from "@/lib/assistant/db";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const google = hasDb() ? await googleConnection(auth.userId).catch(() => null) : null;
  return jsonOk({
    database: hasDb(),
    providers: agentProviders(),
    google: { configured: googleConfigured(), connected: Boolean(google), email: google?.email || null },
    browser: { configured: browserConfigured() },
    github: { connected: Boolean(auth.githubToken) },
    scheduler: { configured: Boolean(process.env.CRON_SECRET) },
  });
}
