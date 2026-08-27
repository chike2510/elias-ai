import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";
import { chooseProvider, completeWithProvider, pickModel } from "@/lib/providers";
import type { ProviderName } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReviewFinding = { id: string; severity: "critical" | "high" | "medium" | "low"; title: string; detail: string; evidence: Array<{ path: string; line?: number; quote?: string }>; recommendation: string; confidence: number };
const providers = new Set<ProviderName>(["qwen", "agentrouter", "groq", "openrouter", "cerebras", "mistral", "github"]);
const safePath = (value: string) => value.length > 0 && value.length < 240 && !value.includes("..") && !value.startsWith("/");
function parseModelJson(text: string): { summary?: string; riskLevel?: string; findings?: unknown[] } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The review model did not return structured JSON.");
  return JSON.parse(cleaned.slice(start, end + 1)) as { summary?: string; riskLevel?: string; findings?: unknown[] };
}
function clampText(value: unknown, max: number) { return typeof value === "string" ? value.slice(0, max) : ""; }

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const session = await getSession();
  const token = await getGitHubToken(session);
  if (!token) return NextResponse.json({ message: "Connect GitHub for this Elias account first." }, { status: 401 });
  let body: { paths?: unknown; diff?: unknown; branch?: unknown; provider?: unknown; model?: unknown; architecture?: unknown };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ message: "Invalid review request." }, { status: 400 }); }
  const paths = Array.isArray(body.paths) ? body.paths.filter((value): value is string => typeof value === "string" && safePath(value)).slice(0, 8) : [];
  const diff = typeof body.diff === "string" ? body.diff.slice(0, 35_000) : "";
  if (!paths.length && !diff.trim()) return NextResponse.json({ message: "Select at least one source file or provide a diff." }, { status: 400 });
  const { owner, repo } = await params;
  const branch = typeof body.branch === "string" && safePath(body.branch) ? body.branch : "main";
  const githubHeaders = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const selectedFiles: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const response = await fetch(`${base}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers: githubHeaders, cache: "no-store" });
    if (!response.ok) continue;
    const payload = await response.json() as { content?: string; encoding?: string; type?: string };
    if (payload.type === "file" && payload.content && payload.encoding === "base64") selectedFiles.push({ path, content: Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8").slice(0, 14_000) });
  }
  const sourceContext = selectedFiles.map((file) => `FILE: ${file.path}\n${file.content}`).join("\n\n").slice(0, 48_000);
  const architectureContext = body.architecture && typeof body.architecture === "object" ? JSON.stringify(body.architecture).slice(0, 12_000) : "(not supplied)";
  const provider = typeof body.provider === "string" && providers.has(body.provider as ProviderName) ? body.provider as ProviderName : await chooseProvider("code", 8);
  if (!provider) return NextResponse.json({ message: "No configured AI provider is available for model-assisted review." }, { status: 503 });
  const requestedModel = typeof body.model === "string" && body.model.length < 180 ? body.model : undefined;
  const model = requestedModel || await pickModel(provider, "code");
  if (!model) return NextResponse.json({ message: `No usable model is available for ${provider}.` }, { status: 503 });
  const prompt = `Review the selected source files and optional diff as a senior application-security and code-quality reviewer. Do not invent files, lines, runtime behavior, or vulnerabilities. Only report actionable issues supported by the supplied evidence. Prioritize correctness, security, data privacy, auth boundaries, error handling, tests, performance, and maintainability. Return JSON only with this exact shape: {"summary":"string","riskLevel":"low|medium|high|critical","findings":[{"id":"short-id","severity":"critical|high|medium|low","title":"string","detail":"string","evidence":[{"path":"path from input or DIFF","line":1,"quote":"short exact quote or diff hunk"}],"recommendation":"string","confidence":0.0}]}. Use an empty findings array when no supported issue exists.\n\nBRANCH: ${branch}\n\nARCHITECTURE CONTEXT:\n${architectureContext}\n\nSELECTED FILES:\n${sourceContext || "(none)"}\n\nDIFF:\n${diff || "(none)"}`;
  try {
    const response = await completeWithProvider({ provider, model, temperature: 0.1, messages: [{ role: "system", content: "You are ELIAS Code Review. Output valid JSON only." }, { role: "user", content: prompt }] });
    const parsed = parseModelJson(response.text);
    const findings: ReviewFinding[] = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 20).flatMap((value, index) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const severity = ["critical", "high", "medium", "low"].includes(String(item.severity)) ? String(item.severity) as ReviewFinding["severity"] : "medium";
      const evidence = Array.isArray(item.evidence) ? item.evidence.slice(0, 4).flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const source = entry as Record<string, unknown>; const path = clampText(source.path, 240); if (!path) return []; return [{ path, ...(typeof source.line === "number" ? { line: Math.max(1, Math.round(source.line)) } : {}), ...(typeof source.quote === "string" ? { quote: source.quote.slice(0, 320) } : {}) }]; }) : [];
      if (!evidence.length) return [];
      return [{ id: clampText(item.id, 80) || `finding-${index + 1}`, severity, title: clampText(item.title, 180) || "Review finding", detail: clampText(item.detail, 900), evidence, recommendation: clampText(item.recommendation, 900), confidence: Math.min(1, Math.max(0, typeof item.confidence === "number" ? item.confidence : 0.6)) }];
    }) : [];
    return NextResponse.json({ review: { summary: clampText(parsed.summary, 1_200), riskLevel: ["low", "medium", "high", "critical"].includes(String(parsed.riskLevel)) ? parsed.riskLevel : "medium", findings, reviewedFiles: selectedFiles.map((file) => file.path), diffIncluded: Boolean(diff.trim()), provider, model, branch, generatedAt: new Date().toISOString() } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Model-assisted code review failed." }, { status: 502 });
  }
}
