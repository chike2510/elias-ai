import { NextResponse } from "next/server";
import { handleStep } from "@/lib/browserRun/decide";
import { workerAuthorized } from "@/lib/browserRun/runner";
import type { StepInput } from "@/lib/browserRun/core";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/** The browser Worker posts each observation here (Bearer ELIAS_WORKER_SECRET) and gets back the next action. */
export async function POST(request: Request, { params }: Params) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  let input: StepInput;
  try { input = await request.json() as StepInput; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  try { return NextResponse.json(await handleStep(id, input)); }
  catch (error) { return NextResponse.json({ kind: "stop", reason: error instanceof Error ? error.message.slice(0, 300) : "step failed" }); }
}
