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
  const back = jar.get("elias_google_return")?.value || "/";
  const target = (query: string) => new URL(`${back.startsWith("/") && !back.startsWith("//") ? back : "/"}${back.includes("?") ? "&" : "?"}${query}`, request.url);
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/", request.url));
  const code = url.searchParams.get("code");
  if (!code || !saved || url.searchParams.get("state") !== saved) return NextResponse.redirect(target("error=google_state"));
  try {
    await exchangeGoogleCode(request, code, session.userId);
    return NextResponse.redirect(target("connected=google"));
  } catch (error) {
    return NextResponse.redirect(target(`error=${encodeURIComponent(error instanceof Error ? error.message : "google_failed")}`));
  }
}
