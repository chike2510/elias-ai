import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";

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
  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.redirect(new URL("/projects?error=github_connection_failed", request.url));
  await setSession({ ...session, githubToken: tokenData.access_token, githubConnected: true });
  return NextResponse.redirect(new URL("/projects?connected=github", request.url));
}
