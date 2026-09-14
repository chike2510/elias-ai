import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listModels, providerDiagnostics, configuredProviders } from "@/lib/providers";
export const runtime = "nodejs";
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  await Promise.all(configuredProviders().map((provider) => listModels(provider)));
  const diagnostics = providerDiagnostics();
  return NextResponse.json({ ok: true, providers: Object.entries(diagnostics).map(([provider, value]) => ({ provider, configured: value.configured, catalogReachable: value.ok, modelCount: value.modelCount, latencyMs: value.latencyMs, error: value.error })) });
}
