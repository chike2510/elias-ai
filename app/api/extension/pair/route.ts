import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { createExtensionToken } from "@/lib/extensionAuth";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Sign in to Elias before pairing a browser extension.", 401, "AUTH_REQUIRED");
  return jsonOk({ token: createExtensionToken(session), expiresIn: 60 * 60 * 24 * 30, login: session.login });
}
