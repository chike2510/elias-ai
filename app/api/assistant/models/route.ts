import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { getModelChoice, modelOptions, setModelChoice } from "@/lib/assistant/models";
import { parseChoice } from "@/lib/assistant/modelRouter";

export const runtime = "nodejs";

/** GET (?only=choice for just the saved choice): the picker's options (modes + configured providers/models) and the user's saved choice. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    if (request.nextUrl.searchParams.get("only") === "choice") return jsonOk({ choice: await getModelChoice(auth.userId).catch(() => "auto") });
    const [options, choice] = await Promise.all([modelOptions(), getModelChoice(auth.userId).catch(() => "auto")]);
    return jsonOk({ ...options, choice });
  } catch (error) { return jsonError(reportError(error, "assistant/models", auth.userId)); }
}

/** PUT { model: "auto" | "fast" | "strong" | "<provider>/<model>" } saves the user's choice. */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ model?: string }>(request);
    const parsed = parseChoice(body.model);
    if (body.model && body.model !== "auto" && parsed.mode === "auto") return jsonError("Unknown model choice.", 400, "BAD_REQUEST");
    return jsonOk({ choice: await setModelChoice(auth.userId, body.model) });
  } catch (error) { return jsonError(reportError(error, "assistant/models", auth.userId), 400); }
}
