import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, vercelConfigured } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!vercelConfigured()) return NextResponse.redirect(new URL("/projects?error=vercel_not_configured", request.url));
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("elias_vercel_connect_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://vercel.com/oauth/authorize");
  url.searchParams.set("client_id", process.env.VERCEL_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${new URL(request.url).origin}/api/connect/vercel/callback`);
  url.searchParams.set("scope", "user project deployment team");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
