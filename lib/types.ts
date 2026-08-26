export type TaskType = "general" | "code" | "research" | "study";

export type ProviderName = "qwen" | "agentrouter" | "groq" | "openrouter" | "cerebras" | "mistral" | "github";

export type WorkspaceFile = {
  path: string;
  content: string;
  size?: number;
};

export type ProviderConfig = {
  name: ProviderName;
  key?: string;
  baseUrl: string;
  fallbackModels: string[];
};

export type AgentRequest =
  | { id?: string; type: "inspect_project" }
  | { id?: string; type: "list_files"; prefix?: string }
  | { id?: string; type: "read_file"; path: string }
  | { id?: string; type: "search_files"; query: string }
  | { id?: string; type: "inspect_dependencies" }
  | { id?: string; type: "run_validation"; check: "build" | "typecheck" | "lint" | "test" }
  | { id?: string; type: "search_web"; query: string }
  | { id?: string; type: "fetch_url"; url: string }
  | { id?: string; type: "browser_navigate"; url: string; sessionId?: string }
  | { id?: string; type: "browser_click"; selector: string; sessionId?: string }
  | { id?: string; type: "browser_type"; selector: string; text: string; sessionId?: string }
  | { id?: string; type: "browser_scroll"; direction: "up" | "down"; amount?: number; sessionId?: string }
  | { id?: string; type: "browser_screenshot"; sessionId?: string }
  | { id?: string; type: "browser_extract"; selector?: string; sessionId?: string }
  | { id?: string; type: "create_artifact"; name: string; content: string; mimeType?: string; encoding?: "utf8" | "base64" };

export type AgentAction =
  | { id?: string; type: "write_file"; path: string; content: string }
  | { id?: string; type: "append_file"; path: string; content: string }
  | { id?: string; type: "edit_file"; path: string; find: string; replace: string; all?: boolean }
  | { id?: string; type: "delete_file"; path: string }
  | { id?: string; type: "rename_file"; path: string; to: string };

export type ToolResult = {
  id?: string;
  type: string;
  path?: string;
  query?: string;
  url?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

export type AgentActivity = {
  id: string;
  kind: "plan" | "tool" | "action" | "validation" | "error" | "message";
  label: string;
  status: "started" | "completed" | "failed";
  detail?: string;
  createdAt: number;
};
