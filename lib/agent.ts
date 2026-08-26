import type { AgentAction, AgentRequest, TaskType, ToolResult, WorkspaceFile } from "@/lib/types";
import { chooseProvider, completeWithProvider, pickModel, providerOrder } from "@/lib/providers";

export type AgentInput = {
  task: string;
  browserSessionId?: string;
  preferredProvider?: Parameters<typeof completeWithProvider>[0]["provider"];
  preferredModel?: string;
  taskType: TaskType;
  files: WorkspaceFile[];
  messages: { role: string; content: string }[];
  toolResults: ToolResult[];
};

export type AgentOutput = {
  ok: true;
  provider: string;
  model: string;
  message: string;
  requests: AgentRequest[];
  actions: AgentAction[];
  done: boolean;
};

function complexity(task: string, files: WorkspaceFile[]) {
  let value = 3;
  if (/build|implement|refactor|debug|repository|project|tsx|jsx|typescript|javascript|api|database/i.test(task)) value += 3;
  if (/entire|complete|full|production|autonomous|all files/i.test(task)) value += 2;
  if (files.length > 20) value += 1;
  if (files.reduce((sum, file) => sum + file.content.length, 0) > 100_000) value += 1;
  return Math.min(10, value);
}

const SYSTEM = `You are ELIAS, an autonomous software engineering and research agent.

You operate over a user-provided workspace. You must use structured requests and actions only for operations the host can execute.

Available requests:
- inspect_project
- list_files with optional prefix
- read_file with exact path
- search_files with query
- inspect_dependencies
- run_validation with check: build, typecheck, lint, or test
- search_web with query
- fetch_url with URL
- browser_navigate with a URL and optional linked sessionId
- browser_click with a CSS selector and optional linked sessionId
- browser_type with a CSS selector, text, and optional linked sessionId
- browser_scroll with direction, amount, and optional linked sessionId
- browser_screenshot with optional linked sessionId
- browser_extract with optional selector and linked sessionId
- create_artifact with name, content, optional mimeType, and encoding (use mimeType application/pdf for PDF deliverables; provide readable source text and let the host encode it)

Available actions:
- write_file with exact path and complete content
- append_file with exact path and content
- edit_file with exact path, find, replace, and optional all flag
- delete_file with exact path
- rename_file with exact path and destination

Rules:
1. Never invent file contents when a read result is available.
2. Work incrementally and keep payloads reasonably sized.
3. Preserve existing architecture unless the task requires change.
4. Never claim that an operation happened unless the host returns a successful tool result.
5. Use web tools when current external information matters.
6. Do not request shell commands, package installs, builds, tests, lint, git, or arbitrary code execution; the current host exposes file and web tools only. Browser click and typing requests are always approval-gated by the host.
7. Return one JSON object with this shape when possible: {"message":"...","requests":[],"actions":[],"done":false}.
8. The message is for the user; requests/actions are the executable protocol. Never put fake tool activity in the message.`;

function extractJson(raw: string): unknown | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Recover a balanced object from provider-added prose.
  }
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isRequest(value: unknown): value is AgentRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.type !== "string") return false;
  if (["inspect_project", "list_files", "read_file", "search_files", "inspect_dependencies", "run_validation", "search_web", "fetch_url", "browser_navigate", "browser_click", "browser_type", "browser_scroll", "browser_screenshot", "browser_extract", "create_artifact"].includes(item.type)) {
    if (item.type === "read_file" && typeof item.path !== "string") return false;
    if (item.type === "search_files" && typeof item.query !== "string") return false;
    if (item.type === "run_validation" && !["build", "typecheck", "lint", "test"].includes(String(item.check))) return false;
    if (item.type === "search_web" && typeof item.query !== "string") return false;
    if (item.type === "fetch_url" && typeof item.url !== "string") return false;
    if (item.type === "browser_navigate" && typeof item.url !== "string") return false;
    if (item.type === "browser_click" && typeof item.selector !== "string") return false;
    if (item.type === "browser_type" && (typeof item.selector !== "string" || typeof item.text !== "string")) return false;
    if (item.type === "browser_scroll" && (!["up", "down"].includes(String(item.direction)))) return false;
    if (item.type === "create_artifact" && (typeof item.name !== "string" || typeof item.content !== "string" || (item.encoding !== undefined && !["utf8", "base64"].includes(String(item.encoding))))) return false;
    return true;
  }
  return false;
}

function isAction(value: unknown): value is AgentAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.type !== "string" || typeof item.path !== "string") return false;
  if (item.type === "write_file" || item.type === "append_file") return typeof item.content === "string";
  if (item.type === "edit_file") return typeof item.find === "string" && typeof item.replace === "string";
  if (item.type === "rename_file") return typeof item.to === "string";
  return item.type === "delete_file";
}

function normalizeAgentOutput(raw: string, provider: string, model: string): AgentOutput {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return { ok: true, provider, model, message: raw.trim() || "ELIAS returned an empty response.", requests: [], actions: [], done: true };
  }
  const value = parsed as Record<string, unknown>;
  const requests = Array.isArray(value.requests) ? value.requests.filter(isRequest) : [];
  const actions = Array.isArray(value.actions) ? value.actions.filter(isAction) : [];
  return {
    ok: true,
    provider,
    model,
    message: typeof value.message === "string" ? value.message : "",
    requests,
    actions,
    done: Boolean(value.done) || (!requests.length && !actions.length),
  };
}

async function call(provider: Parameters<typeof completeWithProvider>[0]["provider"], model: string, input: AgentInput) {
  const response = await completeWithProvider({
    provider,
    model,
    temperature: 0.15,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `TASK:\n${input.task}`,
          `WORKSPACE:\n${input.files.map((file) => `${file.path} (${file.content.length} chars)`).join("\n")}`,
          `TOOL RESULTS:\n${JSON.stringify(input.toolResults).slice(0, 90_000)}`,
          `BROWSER SESSION:\n${input.browserSessionId || "No connected browser session. Request one only when the user has connected a browser."}`,
          `RECENT AGENT CONVERSATION:\n${input.messages.map((message) => `${message.role}: ${message.content}`).join("\n")}`,
        ].join("\n\n"),
      },
    ],
  });
  return normalizeAgentOutput(response.text, provider, model);
}

export async function runAgentStep(input: AgentInput): Promise<AgentOutput> {
  const score = complexity(input.task, input.files);
  const preferred = input.preferredProvider || await chooseProvider(input.taskType, score);
  if (!preferred) throw new Error("No configured AI provider is available. Add at least one provider key in Vercel.");

  const candidates = [preferred, ...providerOrder(input.taskType, score)].filter((item, index, array) => array.indexOf(item) === index);
  const errors: string[] = [];
  for (const provider of candidates) {
    try {
      const model = input.preferredModel && provider === input.preferredProvider ? input.preferredModel : await pickModel(provider, input.taskType);
      if (!model) continue;
      return await call(provider, model, input);
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new Error(`All configured providers failed. ${errors.slice(0, 4).join(" | ")}`);
}
