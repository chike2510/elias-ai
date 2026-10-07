import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/assistant/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/", request.url));
  const back = new URL(request.url).searchParams.get("return") || "/";
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  if (!googleConfigured()) return NextResponse.redirect(new URL(`${safeBack}${safeBack.includes("?") ? "&" : "?"}error=google_not_configured`, request.url));
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("elias_google_return", safeBack, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  (await cookies()).set("elias_google_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(googleAuthUrl(request, state));
}
