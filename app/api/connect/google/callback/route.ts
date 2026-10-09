import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exchangeGoogleCode } from "@/lib/assistant/google";
import { scopeFlags } from "@/lib/assistant/googleCore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get("elias_google_state")?.value;
  const back = jar.get("elias_google_return")?.value || "/";
  jar.set("elias_google_state", "", { path: "/", maxAge: 0 });
  jar.set("elias_google_return", "", { path: "/", maxAge: 0 });
  const safeBack = back.startsWith("/") && !back.startsWith("//") && !back.startsWith("/\\") ? back : "/";
  const target = (query: string) => new URL(`${safeBack}${safeBack.includes("?") ? "&" : "?"}${query}`, request.url);
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/", request.url));
  // The user pressed Cancel / Back on Google's consent screen.
  const denied = url.searchParams.get("error");
  if (denied) return NextResponse.redirect(target(`error=${denied === "access_denied" ? "google_cancelled" : "google_" + encodeURIComponent(denied)}`));
  const code = url.searchParams.get("code");
  if (!code || !saved || url.searchParams.get("state") !== saved) return NextResponse.redirect(target("error=google_state_expired_try_again"));
  try {
    const result = await exchangeGoogleCode(request, code, session.userId);
    const flags = scopeFlags(result.scope);
    // Google's granular consent lets people untick boxes: say what's missing instead of failing later.
    const missing = [flags.gmail ? "" : "gmail", flags.calendar ? "" : "calendar"].filter(Boolean);
    return NextResponse.redirect(target(missing.length ? `connected=google&missing=${missing.join(",")}` : "connected=google"));
  } catch (error) {
    return NextResponse.redirect(target(`error=${encodeURIComponent((error instanceof Error ? error.message : "google_failed").slice(0, 120))}`));
  }
}
