import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { getSettings, setCity, weatherFor } from "@/lib/assistant/brief";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ settings: await getSettings(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "assistant/settings", auth.userId)); }
}

/** PATCH { city } — the place used for the brief's weather. Validated against open-meteo geocoding. */
export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ city?: string }>(request);
    const city = (body.city || "").trim().slice(0, 80);
    if (!city) return jsonError("Give a city.", 400, "BAD_REQUEST");
    const weather = await weatherFor(city);
    await setCity(auth.userId, city);
    return jsonOk({ settings: await getSettings(auth.userId), weather });
  } catch (error) { return jsonError(reportError(error, "assistant/settings", auth.userId), 400); }
}
