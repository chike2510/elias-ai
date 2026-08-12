import { NextRequest, NextResponse } from "next/server";
import { runAgentStep } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();

    if (!input?.task || !input?.taskType) {
      return NextResponse.json(
        { error: "task and taskType are required" },
        { status: 400 },
      );
    }

    const result = await runAgentStep(input);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ELIAS agent step failed." },
      { status: 500 },
    );
  }
}
