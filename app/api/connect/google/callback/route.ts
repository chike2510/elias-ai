import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exchangeGoogleCode } from "@/lib/assistant/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get("elias_google_state")?.value;
  jar.set("elias_google_state", "", { path: "/", maxAge: 0 });
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/assistant", request.url));
  const code = url.searchParams.get("code");
  if (!code || !saved || url.searchParams.get("state") !== saved) return NextResponse.redirect(new URL("/assistant?error=google_state", request.url));
  try {
    await exchangeGoogleCode(request, code, session.userId);
    return NextResponse.redirect(new URL("/assistant?connected=google", request.url));
  } catch (error) {
    return NextResponse.redirect(new URL(`/assistant?error=${encodeURIComponent(error instanceof Error ? error.message : "google_failed")}`, request.url));
  }
}
