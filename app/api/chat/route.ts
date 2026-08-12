import { NextRequest, NextResponse } from "next/server";
import { runChat } from "@/lib/chat";
import type { TaskType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const task = (body.task || "general") as TaskType;

    if (!messages.length) {
      return NextResponse.json({ error: "messages are required" }, { status: 400 });
    }

    return NextResponse.json(await runChat({ messages, task }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ELIAS could not respond." },
      { status: 500 },
    );
  }
}
