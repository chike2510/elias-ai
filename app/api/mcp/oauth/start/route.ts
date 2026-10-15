import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startOAuth } from "@/lib/assistant/mcp";

export const runtime = "nodejs";

const origin = (request: Request) => (process.env.ELIAS_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}`, request.url));
  const server = new URL(request.url).searchParams.get("server") || "";
  try {
    return NextResponse.redirect(await startOAuth(session.userId, server, `${origin(request)}/api/mcp/oauth/callback`));
  } catch (error) {
    return NextResponse.redirect(new URL(`/?notice=${encodeURIComponent(error instanceof Error ? error.message : "Sign-in failed")}`, request.url));
  }
}
