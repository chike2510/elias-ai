import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { describeSpec, setScheduleStatus, updateSchedule } from "@/lib/assistant/schedules";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** PATCH { status?: active|paused|cancelled, time?: "HH:MM", name?, prompt?, timezone? } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ status?: string; time?: string; name?: string; prompt?: string; timezone?: string }>(request);
    if (body.status !== undefined && !["active", "paused", "cancelled"].includes(body.status)) return jsonError("status must be active, paused or cancelled.", 400);
    let schedule = null;
    if (body.time !== undefined || body.name !== undefined || body.prompt !== undefined || body.timezone !== undefined) schedule = await updateSchedule(auth.userId, id, body);
    if (body.status) schedule = await setScheduleStatus(auth.userId, id, body.status as "active");
    if (!schedule) return jsonError("Scheduled task not found.", 404, "NOT_FOUND");
    return jsonOk({ schedule: { ...schedule, when: describeSpec(schedule.spec, schedule.timezone) } });
  } catch (error) { return jsonError(reportError(error, "assistant/schedules/id", auth.userId), 400); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { return jsonOk({ schedule: await setScheduleStatus(auth.userId, id, "cancelled") }); }
  catch (error) { return jsonError(reportError(error, "assistant/schedules/id", auth.userId), 400); }
}
