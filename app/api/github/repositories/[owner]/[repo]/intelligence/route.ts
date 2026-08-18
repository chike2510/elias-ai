import { NextResponse } from "next/server";
import { posix } from "node:path";
import { getSession } from "@/lib/auth";

type TreeEntry = { path: string; type: "blob" | "tree"; size?: number; sha: string };
type Finding = { id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; evidence: string[]; path?: string };

const headersFor = (token: string) => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" });
function textFromBase64(value: string) { return Buffer.from(value, "base64").toString("utf8"); }
function riskFinding(severity: Finding["severity"], title: string, detail: string, evidence: string[], path?: string): Finding { return { id: `${severity}_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, severity, title, detail, evidence, ...(path ? { path } : {}) }; }
function roleFor(path: string) { if (/(^|\/)(app|pages|routes?)\//.test(path) || /(^|\/)(route|page)\.(ts|tsx|js|jsx)$/.test(path)) return "route"; if (/(^|\/)(api|server|lib|services?)\//.test(path)) return "backend"; if (/(^|\/)(components?|ui|views?)\//.test(path)) return "ui"; if (/(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.[jt]sx?$/.test(path)) return "test"; if (/(config|schema|middleware|auth)/i.test(path)) return "configuration"; return "module"; }
function importsFrom(text: string) { const values = [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]).filter(Boolean); return [...new Set(values)].slice(0, 40); }
function resolveImport(from: string, target: string, knownPaths: Set<string>) {
  if (!(target.startsWith(".") || target.startsWith("@/"))) return null;
  const root = target.startsWith("@/") ? target.slice(2) : posix.normalize(posix.join(posix.dirname(from), target));
  const candidates = [root, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].map((extension) => `${root}${extension}`), ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${root}/index${extension}`)];
  return candidates.find((candidate) => knownPaths.has(candidate)) || null;
}

export async function GET(_: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const session = await getSession();
  if (!session?.githubToken) return NextResponse.json({ message: "Connect GitHub for this Elias account first." }, { status: 401 });
  const { owner, repo } = await params;
  const headers = headersFor(session.githubToken);
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repositoryResponse = await fetch(base, { headers, cache: "no-store" });
  if (!repositoryResponse.ok) return NextResponse.json({ message: `GitHub repository request failed (${repositoryResponse.status}).` }, { status: repositoryResponse.status });
  const repository = await repositoryResponse.json() as { full_name: string; default_branch?: string; language?: string | null; topics?: string[]; license?: { spdx_id?: string | null } | null };
  const branch = repository.default_branch || "main";
  const refResponse = await fetch(`${base}/git/ref/heads/${encodeURIComponent(branch)}`, { headers, cache: "no-store" });
  if (!refResponse.ok) return NextResponse.json({ message: `Could not read the ${branch} branch.` }, { status: refResponse.status });
  const ref = await refResponse.json() as { object?: { sha?: string } };
  const treeResponse = await fetch(`${base}/git/trees/${encodeURIComponent(ref.object?.sha || branch)}?recursive=1`, { headers, cache: "no-store" });
  if (!treeResponse.ok) return NextResponse.json({ message: `Could not read the repository tree (${treeResponse.status}).` }, { status: treeResponse.status });
  const treePayload = await treeResponse.json() as { tree?: TreeEntry[]; truncated?: boolean };
  const tree = (treePayload.tree || []).filter((entry) => entry.type === "blob");
  const paths = tree.map((entry) => entry.path);
  const keyNames = ["package.json", "tsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts", "vite.config.ts", "Dockerfile", ".env.example", "README.md", "drizzle/schema.ts", "prisma/schema.prisma"];
  const keyEntries = tree.filter((entry) => keyNames.includes(entry.path) || /(^|\/)(auth|middleware|route|server|api|security|config)[^/]*\.(ts|tsx|js|jsx)$/.test(entry.path) || /(^|\/)(app|src|lib|components|pages)\/[^/]+\.(ts|tsx|js|jsx)$/.test(entry.path)).slice(0, 60);
  const contents = await Promise.all(keyEntries.map(async (entry) => { const response = await fetch(`${base}/contents/${entry.path}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store" }); if (!response.ok) return { path: entry.path, text: "" }; const payload = await response.json() as { content?: string; encoding?: string }; return { path: entry.path, text: payload.content && payload.encoding === "base64" ? textFromBase64(payload.content) : "" }; }));
  const files = contents.filter((item) => item.text).map((item) => ({ path: item.path, lines: item.text.split("\n").length, chars: item.text.length }));
  const findings: Finding[] = [];
  const packageJson = contents.find((item) => item.path === "package.json");
  let dependencies: Record<string, string> = {};
  if (packageJson) { try { const parsed = JSON.parse(packageJson.text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; dependencies = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }; } catch { findings.push(riskFinding("warning", "package.json is not valid JSON", "The package manifest could not be parsed automatically, so dependency and script analysis is incomplete.", ["package.json"], "package.json")); } }
  const envExample = contents.find((item) => item.path === ".env.example");
  if (envExample && /(secret|token|api[_-]?key|password)/i.test(envExample.text)) findings.push(riskFinding("info", "Environment variables are documented", "Review the example file to ensure it contains names only and never sample credentials.", [".env.example"], ".env.example"));
  const secrets = contents.filter((item) => /\.(ts|tsx|js|jsx|json|yml|yaml|env)$/.test(item.path)).flatMap((item) => { const matches = item.text.split("\n").map((line, index) => ({ line, index: index + 1 })).filter(({ line }) => /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}/i.test(line) && !/process\.env|import\.meta\.env|example|placeholder|dummy/i.test(line)); return matches.slice(0, 3).map(({ index }) => `${item.path}:${index}`); });
  if (secrets.length) findings.push(riskFinding("critical", "Possible hard-coded credential", "A source file appears to contain a credential-like assignment that is not read from an environment variable. Rotate any exposed secret and move it to protected configuration.", secrets));
  const testCount = paths.filter((path) => /(^|\/)(__tests__|tests?)(\/|\.)|\.(test|spec)\.[jt]sx?$/.test(path)).length;
  if (!testCount) findings.push(riskFinding("warning", "No test files detected", "The repository tree does not contain recognizable unit or integration tests. Add a regression suite before making high-risk changes.", ["Repository tree"]));
  if (!paths.some((path) => /(^|\/)(README|readme)\./.test(path))) findings.push(riskFinding("info", "README not detected", "Add a concise setup and architecture guide so future Elias tasks have reliable project context.", ["Repository tree"]));
  const routeCount = paths.filter((path) => /(^|\/)(route|page)\.(ts|tsx|js|jsx)$/.test(path) || /(^|\/)api\//.test(path)).length;
  const sourceCount = paths.filter((path) => /\.(ts|tsx|js|jsx|py|go|java|rb|rs|php)$/.test(path)).length;
  if (sourceCount > 0 && !paths.some((path) => /(^|\/)(eslint|biome|prettier)/i.test(path) || /\.(eslintrc|prettierrc)/i.test(path))) findings.push(riskFinding("info", "No obvious formatter or linter configuration", "Consistent static analysis makes automated reviews more reliable and reduces style drift.", ["Repository tree"]));
  const knownPaths = new Set(paths);
  const sourceModules = contents.filter((item) => /\.(ts|tsx|js|jsx|py|go|java|rb|rs|php)$/.test(item.path)).map((item) => { const imports = importsFrom(item.text); const resolvedImports = imports.map((target) => ({ target, resolvedPath: resolveImport(item.path, target, knownPaths) })).filter((item): item is { target: string; resolvedPath: string } => Boolean(item.resolvedPath)); return { path: item.path, role: roleFor(item.path), lines: item.text.split("\n").length, imports, resolvedImports, unresolvedImports: imports.filter((target) => (target.startsWith(".") || target.startsWith("@/")) && !resolvedImports.some((item) => item.target === target)) }; });
  const dependencyEdges = sourceModules.flatMap((module) => module.resolvedImports.map((item) => ({ from: module.path, to: item.resolvedPath, import: item.target }))).slice(0, 500);
  const reverseDependents = dependencyEdges.reduce<Record<string, string[]>>((index, edge) => { index[edge.to] = [...new Set([...(index[edge.to] || []), edge.from])].slice(0, 80); return index; }, {});
  const layerCounts = sourceModules.reduce<Record<string, number>>((counts, module) => { counts[module.role] = (counts[module.role] || 0) + 1; return counts; }, {});
  const configFiles = paths.filter((path) => /(config|schema|middleware|dockerfile|\.env|tsconfig|package\.json|lock)/i.test(path)).slice(0, 80);
  const architecture = { layerCounts, entrypoints: paths.filter((path) => /(^|\/)(page|route|index|main|server)\.(ts|tsx|js|jsx)$/.test(path)).slice(0, 80), configFiles, modules: sourceModules.slice(0, 60), dependencyEdges, reverseDependents, graphTruncated: sourceModules.length > 60 || dependencyEdges.length >= 500 };
  return NextResponse.json({ intelligence: { repository: repository.full_name, branch, language: repository.language || "Unknown", topics: repository.topics || [], license: repository.license?.spdx_id || null, treeSize: paths.length, sourceFiles: sourceCount, routeFiles: routeCount, testFiles: testCount, truncated: Boolean(treePayload.truncated), files, dependencies: Object.keys(dependencies).sort().slice(0, 120), architecture, findings, generatedAt: new Date().toISOString() } });
}
