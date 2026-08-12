import { NextResponse } from "next/server";
import { hasUsableConfig } from "@/lib/providers";

export async function GET() {
  const names = ["qwen","agentrouter","groq","openrouter","cerebras","mistral","github"] as const;
  const configured = Object.fromEntries(names.map((n) => [n, hasUsableConfig(n)]));
  return NextResponse.json({
    ok: true,
    defaultOrder: process.env.ELIAS_PROVIDER_ORDER || "",
    configured
  });
}