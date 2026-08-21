import { NextRequest } from "next/server";
import { runElias } from "@/lib/eliasRuntime";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import type { ProviderName, TaskType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const tasks = new Set<TaskType>(["general", "code", "research", "study"]);
const providers = new Set<ProviderName>(["qwen", "agentrouter", "groq", "openrouter", "cerebras", "mistral", "github"]);

function repositoryFromQuery(query: string) {
  const match = query.match(/(?:github\s+)?repository\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i) || query.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  return match?.[1] || null;
}

async function loadRepositoryContext(query: string) {
  const fullName = repositoryFromQuery(query);
  if (!fullName) return null;
  const session = await getSession();
  if (!session?.githubToken) return null;
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${session.githubToken}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
  const inventoryResponse = await fetch("https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated", { headers, cache: "no-store" });
  if (!inventoryResponse.ok) return { fullName, error: `Connected GitHub could not list repositories (HTTP ${inventoryResponse.status}).` };
  const inventory = await inventoryResponse.json() as Array<{ full_name?: string; description?: string | null; default_branch?: string; language?: string | null; private?: boolean; stargazers_count?: number; open_issues_count?: number }>;
  const repository = inventory.find((item) => item.full_name?.toLowerCase() === fullName.toLowerCase());
  if (!repository) return { fullName, error: `Connected GitHub could not find ${fullName} in the authorized repository list. Refresh the GitHub connection if its access changed.` };
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const commitsResponse = await fetch(`${base}/commits?per_page=6`, { headers, cache: "no-store" });
  const commits = commitsResponse.ok ? await commitsResponse.json() as Array<{ sha?: string; commit?: { message?: string; author?: { name?: string; date?: string } } }> : [];
  return { fullName, repository, commits: commits.slice(0, 6).map((commit) => ({ sha: commit.sha, message: (commit.commit?.message || "Commit").split("\n")[0], author: commit.commit?.author?.name || "GitHub user", date: commit.commit?.author?.date })) };
}

function formatRepositoryContext(context: Awaited<ReturnType<typeof loadRepositoryContext>>) {
  if (!context) return null;
  if ("error" in context) return `[CONNECTED GITHUB REPOSITORY]\n${context.error}\nDo not search the public web for this repository unless the user explicitly asks for external information.`;
  return `[CONNECTED GITHUB REPOSITORY]\nRepository: ${context.fullName}\nDescription: ${context.repository.description || "No description"}\nDefault branch: ${context.repository.default_branch || "main"}\nLanguage: ${context.repository.language || "Unknown"}\nVisibility: ${context.repository.private ? "Private" : "Public"}\nOpen issues: ${context.repository.open_issues_count || 0}\nStars: ${context.repository.stargazers_count || 0}\nRecent commits:\n${context.commits.map((commit) => `- ${commit.message} — ${commit.author}${commit.date ? ` · ${commit.date}` : ""}`).join("\n") || "No recent commits returned."}\n\nUse this connected GitHub context for repository questions. Do not substitute public web search results for repository evidence. If file-level context is required, say that repository intelligence or a file selection is needed.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<{ messages?: unknown; task?: unknown; provider?: unknown; model?: unknown }>(request);
    const messages = Array.isArray(body.messages)
      ? body.messages.filter((message): message is { role: "user" | "assistant" | "system"; content: string } => {
          if (!message || typeof message !== "object") return false;
          const value = message as Record<string, unknown>;
          return ["user", "assistant", "system"].includes(String(value.role)) && typeof value.content === "string";
        })
      : [];
    const task = tasks.has(body.task as TaskType) ? body.task as TaskType : "general";
    const provider = providers.has(body.provider as ProviderName) ? body.provider as ProviderName : undefined;
    const model = typeof body.model === "string" && body.model.trim().length > 0 && body.model.length < 180 ? body.model : undefined;

    if (!messages.length) return jsonError("messages are required", 400, "INVALID_REQUEST");
    if (messages.some((message) => message.content.length > 120_000)) return jsonError("A message is too large.", 413, "PAYLOAD_TOO_LARGE");

    const latestQuery = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    const repositoryContext = await loadRepositoryContext(latestQuery);
    const enrichedMessages = repositoryContext ? [...messages, { role: "system" as const, content: formatRepositoryContext(repositoryContext) || "" }] : messages;
    const allowedTools = repositoryContext ? ["document.retrieval", "github.repository"] : ["document.retrieval", "web.search"];
    const result = await runElias({ mode: "auto", taskType: task, provider, model, chat: { messages: enrichedMessages, task }, context: { enabledSkills: ["conversation", "repository-intelligence"], allowedTools } });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "ELIAS could not respond.");
  }
}
