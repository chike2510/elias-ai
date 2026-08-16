import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, publicOrigin, setSession, vercelClientId } from "@/lib/auth";

type VercelTokenResponse = { access_token?: string; team_id?: string | null; error?: string };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  const oauthDescription = url.searchParams.get("error_description");
  if (oauthError) return NextResponse.redirect(new URL(`/projects?error=${encodeURIComponent(oauthDescription || oauthError)}`, request.url));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const savedState = jar.get("elias_vercel_connect_state")?.value;
  jar.set("elias_vercel_connect_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  if (!code || !state || !savedState || state !== savedState) return NextResponse.redirect(new URL("/projects?error=vercel_connection_state", request.url));
  const body = new URLSearchParams({ client_id: vercelClientId(), client_secret: process.env.VERCEL_CLIENT_SECRET?.trim() || "", code, redirect_uri: `${publicOrigin(request)}/api/connect/vercel/callback` });
  const tokenResponse = await fetch("https://api.vercel.com/v2/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const tokenData = await tokenResponse.json() as VercelTokenResponse;
  if (!tokenResponse.ok || !tokenData.access_token) return NextResponse.redirect(new URL(`/projects?error=${encodeURIComponent(tokenData.error || "vercel_connection_failed")}`, request.url));
  await setSession({ ...session, vercelConnected: true, vercelToken: tokenData.access_token, vercelTeamId: tokenData.team_id || undefined });
  return NextResponse.redirect(new URL("/projects?connected=vercel", request.url));
}
