import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { DRIVE_SCOPE, googleAuthUrl, googleConfigured, googleExtraScopes } from "@/lib/assistant/google";

export const runtime = "nodejs";

/** Starts Google OAuth. ?return=/path comes back there; ?scopes=drive adds read-only Drive (also added when the user asked for Drive before). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/", request.url));
  const params = new URL(request.url).searchParams;
  const back = params.get("return") || "/";
  const safeBack = back.startsWith("/") && !back.startsWith("//") && !back.startsWith("/\\") ? back : "/";
  if (!googleConfigured()) return NextResponse.redirect(new URL(`${safeBack}${safeBack.includes("?") ? "&" : "?"}error=google_not_configured`, request.url));
  const extra = new Set(await googleExtraScopes(session.userId).catch(() => [] as string[]));
  if ((params.get("scopes") || "").split(",").includes("drive")) extra.add(DRIVE_SCOPE);
  const state = randomBytes(16).toString("base64url");
  const jar = await cookies();
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set("elias_google_return", safeBack, cookie);
  jar.set("elias_google_state", state, cookie);
  return NextResponse.redirect(googleAuthUrl(request, state, [...extra]));
}
