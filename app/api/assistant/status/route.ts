import { NextRequest } from "next/server";
import { jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/assistant/session";
import { googleConfigured, googleConnection } from "@/lib/assistant/google";
import { browserConfigured } from "@/lib/assistant/browser";
import { agentProviders } from "@/lib/assistant/llm";
import { hasDb } from "@/lib/assistant/db";
import { ensureDailyBrief, getSettings } from "@/lib/assistant/brief";
import { errorTrackingEnabled } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const timezone = request.nextUrl.searchParams.get("timezone") || undefined;
  const db = hasDb();
  const [google, settings] = db ? await Promise.all([
    googleConnection(auth.userId).catch(() => null),
    ensureDailyBrief(auth.userId, timezone).catch(() => null).then(() => getSettings(auth.userId)).catch(() => null),
  ]) : [null, null];
  return jsonOk({
    database: db,
    providers: agentProviders(),
    google: { configured: googleConfigured(), connected: Boolean(google), email: google?.email || null },
    browser: { configured: browserConfigured() },
    github: { connected: Boolean(auth.githubToken) },
    scheduler: { configured: Boolean(process.env.CRON_SECRET) },
    errorTracking: errorTrackingEnabled(),
    settings,
  });
}
