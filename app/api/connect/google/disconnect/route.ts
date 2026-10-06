import { jsonError, jsonOk } from "@/lib/http";
import { disconnectGoogle } from "@/lib/assistant/google";
import { requireUser } from "@/lib/assistant/session";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try { await disconnectGoogle(auth.userId); return jsonOk({ disconnected: true }); }
  catch (error) { return jsonError(error instanceof Error ? error.message : String(error)); }
}
