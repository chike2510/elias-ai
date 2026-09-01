import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, getSession, githubOAuthCredentials, oauthRedirectUri, setSession } from "@/lib/auth";
import { saveGitHubConnection } from "@/lib/githubConnectionStore";

type GithubUser = { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const savedState = jar.get("elias_oauth_state")?.value || "";
  jar.set("elias_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  const flow = savedState.startsWith("connect:") ? "connect" : "login";
  const expectedState = savedState.replace(/^(connect|login):/, "");
  const flowPath = flow === "connect" ? "/connectors/github" : "/login";
  if (!code || !state || !expectedState || state !== expectedState) return NextResponse.redirect(new URL(`${flowPath}?error=oauth_state`, request.url));
  if (!githubConfigured(flow)) return NextResponse.redirect(new URL(`${flowPath}?error=${flow === "connect" ? "github_repository_not_configured" : "github_login_not_configured"}`, request.url));
  const credentials = githubOAuthCredentials(flow)!;

  const callbackUrl = oauthRedirectUri(request, "github");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, redirect_uri: callbackUrl, state }) });
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.redirect(new URL(`${flowPath}?error=${encodeURIComponent(tokenData.error || "github_token_exchange")}`, request.url));

  const profileResponse = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" } });
  const profile = await profileResponse.json() as GithubUser;
  if (!profileResponse.ok || !profile.id || !profile.login) return NextResponse.redirect(new URL(`${flowPath}?error=github_profile`, request.url));

  let email = profile.email || undefined;
  if (!email) {
    const emailResponse = await fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" } });
    if (emailResponse.ok) {
      const emails = await emailResponse.json() as Array<{ email: string; primary?: boolean; verified?: boolean }>;
      email = emails.find((item) => item.primary && item.verified)?.email || emails.find((item) => item.verified)?.email;
    }
  }

  const previous = await getSession();
  if (flow === "connect" && !previous) return NextResponse.redirect(new URL("/login?error=session_expired", request.url));
  if (flow === "connect" && previous && previous.userId !== `github_${profile.id}`) {
    return NextResponse.redirect(new URL("/connectors/github?error=github_account_mismatch", request.url));
  }
  if (flow === "connect" && previous) {
    await saveGitHubConnection({ userId: previous.userId, login: profile.login, name: profile.name || undefined, email: previous.email || email, avatarUrl: profile.avatar_url || previous.avatarUrl, token: tokenData.access_token, scopes: ["repo", "read:org"], connectionType: "repository", connectedAt: previous.createdAt, updatedAt: Date.now() }).catch(() => undefined);
    await setSession({ ...previous, githubToken: tokenData.access_token, githubTokenType: "repository", githubConnected: true });
    return NextResponse.redirect(new URL("/connectors/github?connected=github", request.url));
  }
  const userId = `github_${profile.id}`;
  const createdAt = previous?.createdAt || Date.now();
  const { githubToken: _githubToken, githubTokenType: _githubTokenType, githubConnected: _githubConnected, ...sessionWithoutRepository } = previous || {};
  await setSession({ ...sessionWithoutRepository, userId, login: profile.login, name: profile.name || undefined, email, avatarUrl: profile.avatar_url, createdAt });
  return NextResponse.redirect(new URL("/", request.url));
}
