import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { ChatMessage, ProviderName, TaskType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const task = (body.task || "general") as TaskType;
    const messages = Array.isArray(body.messages) ? body.messages as ChatMessage[] : [];
    const preferredProvider = body.provider as ProviderName | undefined;

    if (!messages.length) {
      return NextResponse.json({ error: "messages are required" }, { status: 400 });
    }

    const result = await runAgent({ task, messages, preferredProvider });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ELIAS could not complete the request." },
      { status: 500 }
    );
  }
}