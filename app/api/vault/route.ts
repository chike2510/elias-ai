import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { deleteSecret, deleteSession, listSecrets, listSessions, saveSecret } from "@/lib/assistant/vault";
import { encryptionConfigured } from "@/lib/assistant/crypto";

export const runtime = "nodejs";

/** Saved logins (masked) and saved browser sessions. Passwords are write-only: nothing here ever returns one. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const [secrets, sessions] = await Promise.all([listSecrets(auth.userId), listSessions(auth.userId)]);
    return jsonOk({ secrets, sessions, encrypted: encryptionConfigured() });
  } catch (error) { return jsonError(reportError(error, "vault", auth.userId)); }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ site?: string; username?: string; password?: string; label?: string; loginUrl?: string; totp?: string }>(request);
    const saved = await saveSecret(auth.userId, { site: body.site || "", username: body.username || "", password: body.password || "", label: body.label, loginUrl: body.loginUrl, totp: body.totp });
    return jsonOk({ saved }, { status: 201 });
  } catch (error) { return jsonError(reportError(error, "vault", auth.userId), 400); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const session = url.searchParams.get("session");
    if (id) return jsonOk({ deleted: await deleteSecret(auth.userId, id) });
    if (session) { await deleteSession(auth.userId, session); return jsonOk({ deleted: true }); }
    return jsonError("Pass id or session.", 400);
  } catch (error) { return jsonError(reportError(error, "vault", auth.userId), 400); }
}
