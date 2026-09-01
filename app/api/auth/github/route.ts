import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, githubOAuthCredentials, oauthRedirectUri } from "@/lib/auth";

export async function GET(request: Request) {
  if (!githubConfigured("login")) return NextResponse.redirect(new URL("/login?error=github_login_not_configured", request.url));
  const credentials = githubOAuthCredentials("login")!;
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("elias_oauth_state", `login:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(request, "github"));
  // Sign-in only needs identity and email. Repository access is requested by the separate connector flow.
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
