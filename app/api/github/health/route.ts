import { NextResponse } from "next/server";
import { diagnoseGitHubConnections } from "@/lib/githubConnectionStore";

export const dynamic = "force-dynamic";

/** Owner-only GitHub connection check: row format, decrypt ok, GitHub's answer. Bearer ELIAS_HEALTH_TOKEN. Never returns tokens. */
export async function GET(request: Request) {
  const token = process.env.ELIAS_HEALTH_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await diagnoseGitHubConnections();
    const ok = result.connections.length > 0 && result.connections.every((item) => item.decryptOk && item.githubStatus === 200);
    return NextResponse.json({ ok, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "diagnosis failed" }, { status: 500 });
  }
}
