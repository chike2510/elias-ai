import {
  AgentAction,
  AgentRequest,
  TaskType,
  ToolResult,
  WorkspaceFile,
} from "@/lib/types";
import { chooseProvider, pickModel, providerConfig, providerOrder } from "@/lib/providers";

export type AgentInput = {
  task: string;
  taskType: TaskType;
  files: WorkspaceFile[];
  messages: { role: string; content: string }[];
  toolResults: ToolResult[];
};

export type AgentOutput = {
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

You operate over a user-provided workspace.

You may request:
- read_file: read an exact workspace file.
- search_web: search current internet information.
- get_url: fetch readable content from a URL.

You may perform:
- write_file: create or replace a file.
- append_file: append a chunk to an existing file.
- rename_file: rename a file.
- delete_file: delete a file only when clearly required.

IMPORTANT:
1. Never invent the contents of a file when the relevant file can be read.
2. Work incrementally on large repositories.
3. Keep individual write/append actions reasonably sized.
4. Preserve existing architecture unless the task requires change.
5. Never delete unrelated functionality.
6. Use web tools when current external information matters.
7. After meaningful edits, use read_file when you need to verify what you changed.
8. The host currently provides file/web tools but not a shell sandbox. Never claim you ran a build, test, lint, npm command, or git command.
9. The application will safely handle a structured payload, but your natural-language message is separate from that payload.

Return one JSON object when possible:
{"message":"...","requests":[],"actions":[],"done":false}

If your provider adds prose or wraps the object in markdown, the host will normalize it.`;

function extractJson(raw: string): unknown | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to recover the first balanced JSON object rather than crashing on normal prose.
  }

  const start = cleaned.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];

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
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeAgentOutput(raw: string, provider: string, model: string): AgentOutput {
  const parsed = extractJson(raw);

  if (!parsed || typeof parsed !== "object") {
    return {
      provider,
      model,
      message: raw.trim() || "ELIAS returned an empty response.",
      requests: [],
      actions: [],
      done: true,
    };
  }

  const value = parsed as Record<string, unknown>;

  return {
    provider,
    model,
    message: typeof value.message === "string" ? value.message : "",
    requests: Array.isArray(value.requests) ? (value.requests as AgentRequest[]) : [],
    actions: Array.isArray(value.actions) ? (value.actions as AgentAction[]) : [],
    done: Boolean(value.done),
  };
}

async function call(
  provider: string,
  model: string,
  input: AgentInput,
): Promise<AgentOutput> {
  const config = providerConfig(provider as any);
  const request = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `TASK:\n${input.task}`,
            `WORKSPACE:\n${input.files.map((file) => `${file.path} (${file.content.length} chars)`).join("\n")}`,
            `TOOL RESULTS:\n${JSON.stringify(input.toolResults).slice(0, 90000)}`,
            `RECENT AGENT CONVERSATION:\n${input.messages.map((message) => `${message.role}: ${message.content}`).join("\n")}`,
          ].join("\n\n"),
        },
      ],
    }),
    cache: "no-store",
  });

  if (!request.ok) {
    throw new Error(
      `${provider} ${request.status}: ${(await request.text()).slice(0, 700)}`,
    );
  }

  const data = await request.json();
  const raw =
    typeof data?.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : "";

  if (!raw) {
    throw new Error(`${provider} returned no content.`);
  }

  return normalizeAgentOutput(raw, provider, model);
}

export async function runAgentStep(input: AgentInput): Promise<AgentOutput> {
  const score = complexity(input.task, input.files);
  const preferred = await chooseProvider(input.taskType, score);

  if (!preferred) {
    throw new Error(
      "No configured AI provider is available. Add at least one provider key in Vercel.",
    );
  }

  const candidates = [
    preferred,
    ...providerOrder(input.taskType, score),
  ].filter((item, index, array) => array.indexOf(item) === index);

  const errors: string[] = [];

  for (const provider of candidates) {
    try {
      const model = await pickModel(provider, input.taskType);
      if (!model) continue;
      return await call(provider, model, input);
    } catch (error) {
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }

  throw new Error(
    `All configured providers failed. ${errors.slice(0, 4).join(" | ")}`,
  );
}
