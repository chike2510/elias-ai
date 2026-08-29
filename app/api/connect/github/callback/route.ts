import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";
import { saveGitHubConnection } from "@/lib/githubConnectionStore";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const savedState = jar.get("elias_github_connect_state")?.value;
  jar.set("elias_github_connect_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  if (!code || !state || !savedState || state !== savedState) return NextResponse.redirect(new URL("/projects?error=github_connection_state", request.url));
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, state }) });
  const tokenData = await tokenResponse.json() as { access_token?: string; scope?: string };
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.redirect(new URL("/projects?error=github_connection_failed", request.url));
  const grantedScopes = tokenData.scope?.split(",").map((scope) => scope.trim()).filter(Boolean) || ["repo", "read:org"];
  await saveGitHubConnection({ userId: session.userId, login: session.login, name: session.name, email: session.email, avatarUrl: session.avatarUrl, token: tokenData.access_token, scopes: grantedScopes, connectedAt: session.createdAt, updatedAt: Date.now() }).catch(() => undefined);
  // Keep an encrypted session fallback when POSTGRES_URL is not configured on Vercel.
  await setSession({ ...session, githubToken: tokenData.access_token, githubConnected: true });
  return NextResponse.redirect(new URL("/projects?connected=github", request.url));
}
