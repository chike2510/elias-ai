type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpToolsResult = { tools?: McpTool[] };

function endpoint() {
  return process.env.VERCEL_MCP_URL?.trim().replace(/\/$/, "") || "";
}

function authorizationHeader() {
  const value = process.env.VERCEL_MCP_AUTHORIZATION?.trim() || process.env.VERCEL_MCP_TOKEN?.trim();
  if (!value) return undefined;
  return value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value}`;
}

function configured() {
  return Boolean(endpoint());
}

async function parseResponse(response: Response): Promise<JsonRpcResponse<unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRpcResponse<unknown>;
  } catch {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (dataLine) {
      try { return JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse<unknown>; } catch { /* fall through */ }
    }
    throw new Error(`Vercel MCP returned an unreadable response (${response.status}).`);
  }
}

async function rpc<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const authorization = authorizationHeader();
  if (authorization) headers.Authorization = authorization;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await fetch(endpoint(), {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  const payload = await parseResponse(response);
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Vercel MCP request failed (${response.status}).`);
  }
  return { payload: payload.result as T, sessionId: response.headers.get("mcp-session-id") || sessionId };
}

async function initialize() {
  const initialized = await rpc<{ protocolVersion?: string }>("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "elias-ai", version: "1.0.0" },
  });
  await rpc("notifications/initialized", {}, initialized.sessionId || undefined).catch(() => undefined);
  return initialized.sessionId || undefined;
}

export async function getVercelMcpStatus() {
  if (!configured()) return { configured: false, connected: false, tools: [], message: "Add VERCEL_MCP_URL to enable the Vercel MCP connector." };
  const sessionId = await initialize();
  const result = await rpc<McpToolsResult>("tools/list", {}, sessionId);
  const tools = result.payload?.tools || [];
  return {
    configured: true,
    connected: true,
    tools: tools.map(({ name, description }) => ({ name, description })),
    message: `Connected to Vercel MCP with ${tools.length} available tool${tools.length === 1 ? "" : "s"}.`,
  };
}

export async function callVercelMcpTool(name: string, argumentsValue: Record<string, unknown> = {}) {
  if (!configured()) throw new Error("Vercel MCP is not configured on this Elias deployment.");
  const sessionId = await initialize();
  const result = await rpc<{ content?: unknown[]; structuredContent?: unknown }>("tools/call", { name, arguments: argumentsValue }, sessionId);
  return result.payload;
}

export function vercelMcpConfigured() {
  return configured();
}
