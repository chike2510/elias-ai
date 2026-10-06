import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { setScheduleStatus } from "@/lib/assistant/schedules";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ status?: string }>(request);
    if (!["active", "paused", "cancelled"].includes(body.status || "")) return jsonError("status must be active, paused or cancelled.", 400);
    return jsonOk({ schedule: await setScheduleStatus(auth.userId, id, body.status as "active") });
  } catch (error) { return jsonError(errorMessage(error), 400); }
}
