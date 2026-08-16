import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { modelCatalog } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const models = await modelCatalog();
  return NextResponse.json({ models: [{ id: "auto", provider: "auto", label: "Auto", detail: "Best model for the task", configured: true }, ...models] });
}
