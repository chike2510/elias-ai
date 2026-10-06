import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { describeSpec, listSchedules } from "@/lib/assistant/schedules";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try { return jsonOk({ schedules: (await listSchedules(auth.userId)).map((item) => ({ ...item, when: describeSpec(item.spec, item.timezone) })) }); }
  catch (error) { return jsonError(errorMessage(error)); }
}
