import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question = String(body.question || "").trim();
    if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

    const prompt = [
      "Research task:",
      question,
      "",
      "If your selected provider has live web-search/tool capabilities, use them.",
      "If it does not, say that live web search was not available rather than inventing current facts.",
      "Return a concise research brief with: answer, key findings, uncertainty, and sources/URLs when available."
    ].join("\n");

    const result = await runAgent({
      task: "research",
      messages: [{ role: "user", content: prompt }]
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Research failed." },
      { status: 500 }
    );
  }
}