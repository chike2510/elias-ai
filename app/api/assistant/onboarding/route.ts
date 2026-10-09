import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { finishOnboarding, onboardingState, resetOnboarding, savePreferences, saveProfile, saveRoutine } from "@/lib/assistant/onboarding";
import { googleConfigured, googleConnection } from "@/lib/assistant/google";
import { pushConfigured } from "@/lib/assistant/push";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const [state, google] = await Promise.all([onboardingState(auth.userId), googleConnection(auth.userId).catch(() => null)]);
    return jsonOk({ onboarding: state, google: { configured: googleConfigured(), connected: google?.status === "ok", email: google?.email || null }, push: { configured: pushConfigured() }, suggestedName: auth.userName || null });
  } catch (error) { return jsonError(reportError(error, "assistant/onboarding", auth.userId)); }
}

type Body = { action?: string; preferredName?: string; timezone?: string; briefTime?: string; city?: string; answers?: Array<{ statement?: unknown }> };

/** POST { action: profile|routine|preferences|complete|skip|reset, ... } */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<Body>(request);
    switch (body.action) {
      case "profile": return jsonOk({ preferredName: await saveProfile(auth.userId, String(body.preferredName || "")) });
      case "routine": return jsonOk({ routine: await saveRoutine(auth.userId, body) });
      case "preferences": return jsonOk({ saved: await savePreferences(auth.userId, Array.isArray(body.answers) ? body.answers : []) });
      case "complete": case "skip": return jsonOk({ onboarding: await finishOnboarding(auth.userId, body.action) });
      case "reset": return jsonOk({ onboarding: await resetOnboarding(auth.userId) });
      default: return jsonError("Unknown action.", 400, "BAD_REQUEST");
    }
  } catch (error) { return jsonError(reportError(error, "assistant/onboarding:post", auth.userId), 400, "ONBOARDING_FAILED"); }
}
