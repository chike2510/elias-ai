export type ProviderName = "qwen" | "agentrouter" | "groq" | "openrouter" | "cerebras" | "mistral" | "github";
export type TaskType = "general" | "code" | "research" | "study";
export type WorkspaceFile = { path:string; content:string; size?:number };
export type ProviderConfig = { name:ProviderName; key?:string; baseUrl:string; fallbackModels:string[] };
export type AgentRequest = { type:"read_file"|"search_web"|"get_url"; path?:string; query?:string; url?:string };
export type AgentAction = { type:"write_file"|"append_file"|"delete_file"|"rename_file"; path?:string; to?:string; content?:string };
export type ToolResult = { type:string; path?:string; content?:string; result?:unknown; error?:string };
