import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { describeSpec, listSchedules } from "@/lib/assistant/schedules";
import { ensureDailyBrief } from "@/lib/assistant/brief";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const timezone = request.nextUrl.searchParams.get("timezone") || undefined;
    await ensureDailyBrief(auth.userId, timezone).catch(() => undefined);
    return jsonOk({ schedules: (await listSchedules(auth.userId)).map((item) => ({ ...item, when: describeSpec(item.spec, item.timezone) })) });
  } catch (error) { return jsonError(reportError(error, "assistant/schedules", auth.userId)); }
}
