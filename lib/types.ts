export type ProviderName =
  | "qwen"
  | "agentrouter"
  | "groq"
  | "openrouter"
  | "cerebras"
  | "mistral"
  | "github";

export type TaskType = "general" | "code" | "research" | "study";

export type ProjectFile = {
  path: string;
  content: string;
  language?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ProviderConfig = {
  name: ProviderName;
  key?: string;
  baseUrl?: string;
  model?: string;
};