import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { hasDb } from "@/lib/assistant/db";
import { listFiles } from "@/lib/assistant/files";

export const runtime = "nodejs";

/** GET ?q= : the user's Library files (no text), newest first. Uploads go through POST /api/assistant/attachments?save=library. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!hasDb()) return jsonOk({ files: [], database: false });
  try { return jsonOk({ files: await listFiles(auth.userId, { q: request.nextUrl.searchParams.get("q") || "" }) }); }
  catch (error) { return jsonError(reportError(error, "assistant/files", auth.userId)); }
}
