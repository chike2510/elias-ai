import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, githubConfigured, oauthRedirectUri } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!githubConfigured()) return NextResponse.redirect(new URL("/projects?error=github_not_configured", request.url));
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("elias_oauth_state", `connect:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", oauthRedirectUri(request, "github"));
  url.searchParams.set("scope", "repo read:org");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
