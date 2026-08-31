import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, getSession, oauthRedirectUri, setSession } from "@/lib/auth";
import { saveGitHubConnection } from "@/lib/githubConnectionStore";

type GithubUser = { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string };

export async function GET(request: Request) {
  if (!githubConfigured()) return NextResponse.redirect(new URL("/login?error=github_not_configured", request.url));
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const savedState = jar.get("elias_oauth_state")?.value || "";
  jar.set("elias_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  const flow = savedState.startsWith("connect:") ? "connect" : "login";
  const expectedState = savedState.replace(/^(connect|login):/, "");
  if (!code || !state || !expectedState || state !== expectedState) return NextResponse.redirect(new URL(`${flow === "connect" ? "/projects" : "/login"}?error=oauth_state`, request.url));

  const callbackUrl = oauthRedirectUri(request, "github");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: callbackUrl, state }) });
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(tokenData.error || "github_token_exchange")}`, request.url));

  const profileResponse = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" } });
  const profile = await profileResponse.json() as GithubUser;
  if (!profileResponse.ok || !profile.id || !profile.login) return NextResponse.redirect(new URL("/login?error=github_profile", request.url));

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
  if (flow === "connect" && previous) {
    await saveGitHubConnection({ userId: previous.userId, login: previous.login, name: previous.name, email: previous.email, avatarUrl: previous.avatarUrl, token: tokenData.access_token, scopes: ["repo", "read:org"], connectedAt: previous.createdAt, updatedAt: Date.now() }).catch(() => undefined);
    await setSession({ ...previous, githubToken: tokenData.access_token, githubConnected: true });
    return NextResponse.redirect(new URL("/projects?connected=github", request.url));
  }
  const userId = `github_${profile.id}`;
  const createdAt = previous?.createdAt || Date.now();
  await saveGitHubConnection({ userId, login: profile.login, name: profile.name || undefined, email, avatarUrl: profile.avatar_url, token: tokenData.access_token, scopes: ["repo", "read:user", "user:email"], connectedAt: createdAt, updatedAt: Date.now() }).catch(() => undefined);
  await setSession({ ...(previous || {}), userId, login: profile.login, name: profile.name || undefined, email, avatarUrl: profile.avatar_url, githubToken: tokenData.access_token, githubConnected: true, createdAt });
  return NextResponse.redirect(new URL("/", request.url));
}
