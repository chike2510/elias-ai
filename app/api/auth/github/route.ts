import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, oauthRedirectUri } from "@/lib/auth";

export async function GET(request: Request) {
  if (!githubConfigured()) return NextResponse.redirect(new URL("/login?error=github_not_configured", request.url));
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("elias_oauth_state", `login:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", oauthRedirectUri(request, "github"));
  // Repository access is required for Projects to list repositories and for explicitly approved GitHub actions.
  // GitHub will show the user the requested permissions during reconnect.
  url.searchParams.set("scope", "read:user user:email repo");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
