import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";

export const runtime = "nodejs";

type Architecture = { modules?: Array<{ path?: string; role?: string; lines?: number; resolvedImports?: Array<{ target?: string; resolvedPath?: string }> }>; reverseDependents?: Record<string, string[]>; entrypoints?: string[]; configFiles?: string[]; dependencyEdges?: Array<{ from?: string; to?: string; import?: string }> };
function safePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length < 240 && !value.includes("..") && !value.startsWith("/"); }
function diffPaths(diff: string) { return [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).filter(safePath); }

export async function POST(request: Request) {
  const session = await getSession();
  if (!await getGitHubToken(session)) return NextResponse.json({ message: "Connect GitHub for this Elias account first." }, { status: 401 });
  let body: { paths?: unknown; diff?: unknown; architecture?: unknown };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ message: "Invalid impact request." }, { status: 400 }); }
  const architecture = body.architecture && typeof body.architecture === "object" ? body.architecture as Architecture : {};
  const requested = Array.isArray(body.paths) ? body.paths.filter(safePath) : [];
  const diff = typeof body.diff === "string" ? body.diff.slice(0, 35_000) : "";
  const changedFiles = [...new Set([...requested, ...diffPaths(diff)])].slice(0, 30);
  if (!changedFiles.length) return NextResponse.json({ message: "Select files or provide a diff before generating an impact report." }, { status: 400 });
  const modules = Array.isArray(architecture.modules) ? architecture.modules.filter((module): module is { path: string; role?: string; lines?: number } => safePath(module.path)) : [];
  const roleByPath = new Map(modules.map((module) => [module.path, module.role || "module"]));
  const reverseDependents = architecture.reverseDependents || {};
  const queue = changedFiles.map((path) => ({ path, distance: 0, reason: "changed directly" }));
  const visited = new Map<string, { path: string; distance: number; reason: string }>();
  while (queue.length && visited.size < 180) {
    const current = queue.shift()!;
    const previous = visited.get(current.path);
    if (previous && previous.distance <= current.distance) continue;
    visited.set(current.path, current);
    for (const dependent of (reverseDependents[current.path] || []).slice(0, 80)) if (!visited.has(dependent) || (visited.get(dependent)?.distance || 99) > current.distance + 1) queue.push({ path: dependent, distance: current.distance + 1, reason: `imports ${current.path}` });
  }
  const affectedFiles = [...visited.values()].filter((item) => !changedFiles.includes(item.path)).sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path)).slice(0, 120).map((item) => ({ ...item, role: roleByPath.get(item.path) || "unknown" }));
  const entrypoints = new Set(architecture.entrypoints || []);
  const impactedEntrypoints = affectedFiles.filter((item) => entrypoints.has(item.path)).map((item) => item.path);
  const impactedTests = affectedFiles.filter((item) => item.role === "test").map((item) => item.path);
  const changedConfig = changedFiles.some((path) => (architecture.configFiles || []).includes(path) || /(config|schema|middleware|\.env|tsconfig|package\.json|lock)/i.test(path));
  const riskLevel = impactedEntrypoints.length || changedConfig || affectedFiles.length > 35 ? "high" : affectedFiles.length > 10 ? "medium" : "low";
  const summary = changedConfig ? "The change touches configuration or infrastructure-sensitive files and may affect multiple runtime surfaces." : impactedEntrypoints.length ? `The change may propagate to ${impactedEntrypoints.length} route or application entrypoint(s).` : affectedFiles.length ? `The change has ${affectedFiles.length} resolved reverse dependents in the analyzed graph.` : "No resolved reverse dependents were found in the analyzed graph.";
  return NextResponse.json({ impact: { changedFiles, affectedFiles, impactedEntrypoints, impactedTests, changedConfig, riskLevel, summary, graphCoverage: { mappedModules: modules.length, resolvedEdges: Array.isArray(architecture.dependencyEdges) ? architecture.dependencyEdges.length : 0 }, generatedAt: new Date().toISOString() } });
}
