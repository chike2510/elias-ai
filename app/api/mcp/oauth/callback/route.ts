import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { finishOAuth } from "@/lib/assistant/mcp";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return NextResponse.redirect(new URL(`/?prompt=${encodeURIComponent(`Connecting that tool failed: ${params.get("error_description") || params.get("error") || "no code returned"}`)}`, request.url));
  try {
    const { name } = await finishOAuth(session.userId, state, code);
    return NextResponse.redirect(new URL(`/?prompt=${encodeURIComponent(`I signed in to ${name}. What can it do for me?`)}`, request.url));
  } catch (error) {
    return NextResponse.redirect(new URL(`/?prompt=${encodeURIComponent(`Connecting that tool failed: ${error instanceof Error ? error.message : "unknown error"}`)}`, request.url));
  }
}
