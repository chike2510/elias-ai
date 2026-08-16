import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVercelMcpStatus } from "@/lib/vercelMcp";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to use the Vercel MCP connector." }, { status: 401 });

  try {
    const status = await getVercelMcpStatus();
    return NextResponse.json(status, { status: status.connected ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      tools: [],
      message: error instanceof Error ? error.message : "Vercel MCP connection failed.",
    }, { status: 502 });
  }
}
