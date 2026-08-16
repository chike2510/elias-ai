import { NextResponse } from "next/server";

const API_BASE = "https://api.vercel.com";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const tools = [
  {
    name: "list_projects",
    description: "List Vercel projects visible to the configured Elias service account.",
    inputSchema: { type: "object", properties: { teamId: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "get_deployment",
    description: "Get a Vercel deployment by ID or hostname.",
    inputSchema: { type: "object", required: ["idOrUrl"], properties: { idOrUrl: { type: "string" }, teamId: { type: "string" } } },
  },
  {
    name: "get_deployment_build_logs",
    description: "Read recent build events for a Vercel deployment.",
    inputSchema: { type: "object", required: ["idOrUrl"], properties: { idOrUrl: { type: "string" }, teamId: { type: "string" }, limit: { type: "number" } } },
  },
];

function expectedBridgeToken() {
  return process.env.VERCEL_MCP_TOKEN?.trim() || "";
}

function apiToken() {
  return process.env.VERCEL_API_TOKEN?.trim() || "";
}

function authorized(request: Request) {
  const expected = expectedBridgeToken();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  return Boolean(expected && provided && provided === expected);
}

function jsonRpc(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: { "Mcp-Session-Id": "elias-vercel-bridge" } });
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

async function vercelFetch(path: string) {
  if (!apiToken()) throw new Error("VERCEL_API_TOKEN is not configured on the Elias deployment.");
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiToken()}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(`Vercel API request failed (${response.status}).`);
  return body;
}

function query(parameters: Record<string, unknown>, keys: string[]) {
  const values = new URLSearchParams();
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === "string" && value) values.set(key, value);
    if (typeof value === "number" && Number.isFinite(value)) values.set(key, String(value));
  }
  return values.toString();
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "list_projects") {
    const suffix = query(args, ["teamId", "limit"]);
    return vercelFetch(`/v9/projects${suffix ? `?${suffix}` : ""}`);
  }
  if (name === "get_deployment") {
    const idOrUrl = typeof args.idOrUrl === "string" ? args.idOrUrl : "";
    if (!idOrUrl || !/^[a-zA-Z0-9._-]+$/.test(idOrUrl)) throw new Error("idOrUrl must be a deployment ID or hostname.");
    const suffix = query(args, ["teamId"]);
    return vercelFetch(`/v13/deployments/${encodeURIComponent(idOrUrl)}${suffix ? `?${suffix}` : ""}`);
  }
  if (name === "get_deployment_build_logs") {
    const idOrUrl = typeof args.idOrUrl === "string" ? args.idOrUrl : "";
    if (!idOrUrl || !/^dpl_[a-zA-Z0-9]+$/.test(idOrUrl)) throw new Error("idOrUrl must be a Vercel deployment ID for build logs.");
    const suffix = query(args, ["teamId", "limit"]);
    return vercelFetch(`/v3/deployments/${encodeURIComponent(idOrUrl)}/events${suffix ? `?${suffix}` : ""}`);
  }
  throw new Error(`Tool '${name}' is not available on this bridge.`);
}

export async function POST(request: Request) {
  if (!expectedBridgeToken()) return errorResponse(null, -32000, "VERCEL_MCP_TOKEN is not configured on the Elias deployment.", 503);
  if (!authorized(request)) return errorResponse(null, -32001, "Unauthorized Vercel MCP bridge request.", 401);

  let payload: JsonRpcRequest;
  try { payload = await request.json() as JsonRpcRequest; } catch { return errorResponse(null, -32700, "Invalid JSON."); }
  const id = payload.id ?? null;
  try {
    if (payload.method === "initialize") {
      return jsonRpc(id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "elias-vercel-bridge", version: "1.0.0" } });
    }
    if (payload.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
    if (payload.method === "tools/list") return jsonRpc(id, { tools });
    if (payload.method === "tools/call") {
      const params = payload.params || {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
      const result = await callTool(name, args);
      return jsonRpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    }
    return errorResponse(id, -32601, `Unsupported MCP method '${payload.method || ""}'.`);
  } catch (error) {
    return errorResponse(id, -32002, error instanceof Error ? error.message : "Vercel MCP bridge request failed.", 502);
  }
}
