import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const API_BASE = "https://api.vercel.com";
type JsonRpcRequest = { id?: string | number | null; method?: string; params?: Record<string, unknown> };
const tools = [
  { name: "list_projects", description: "List Vercel projects visible to this Elias user.", inputSchema: { type: "object", properties: { teamId: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_deployment", description: "Get a Vercel deployment by ID or hostname.", inputSchema: { type: "object", required: ["idOrUrl"], properties: { idOrUrl: { type: "string" }, teamId: { type: "string" } } } },
  { name: "get_deployment_build_logs", description: "Read recent build events for a Vercel deployment.", inputSchema: { type: "object", required: ["idOrUrl"], properties: { idOrUrl: { type: "string" }, teamId: { type: "string" }, limit: { type: "number" } } } },
];
function rpc(id: JsonRpcRequest["id"], result: unknown) { return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: { "Mcp-Session-Id": "elias-user-session" } }); }
function failure(id: JsonRpcRequest["id"], code: number, message: string, status = 400) { return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status }); }
function query(args: Record<string, unknown>, keys: string[]) { const params = new URLSearchParams(); for (const key of keys) { const value = args[key]; if (typeof value === "string" && value) params.set(key, value); if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value)); } return params.toString(); }
async function vercelFetch(token: string, path: string) { const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" }); const text = await response.text(); let body: unknown = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; } if (!response.ok) throw new Error(`Vercel API request failed (${response.status}).`); return body; }
async function callTool(token: string, name: string, args: Record<string, unknown>) {
  if (name === "list_projects") { const suffix = query(args, ["teamId", "limit"]); return vercelFetch(token, `/v9/projects${suffix ? `?${suffix}` : ""}`); }
  const idOrUrl = typeof args.idOrUrl === "string" ? args.idOrUrl : "";
  if (name === "get_deployment") { if (!idOrUrl || !/^[a-zA-Z0-9._-]+$/.test(idOrUrl)) throw new Error("idOrUrl must be a deployment ID or hostname."); const suffix = query(args, ["teamId"]); return vercelFetch(token, `/v13/deployments/${encodeURIComponent(idOrUrl)}${suffix ? `?${suffix}` : ""}`); }
  if (name === "get_deployment_build_logs") { if (!idOrUrl || !/^dpl_[a-zA-Z0-9]+$/.test(idOrUrl)) throw new Error("idOrUrl must be a Vercel deployment ID for build logs."); const suffix = query(args, ["teamId", "limit"]); return vercelFetch(token, `/v3/deployments/${encodeURIComponent(idOrUrl)}/events${suffix ? `?${suffix}` : ""}`); }
  throw new Error(`Tool '${name}' is not available.`);
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.vercelApiToken) return failure(null, -32001, "Connect Vercel for this Elias account before using its tools.", 401);
  let payload: JsonRpcRequest; try { payload = await request.json() as JsonRpcRequest; } catch { return failure(null, -32700, "Invalid JSON."); }
  const id = payload.id ?? null;
  try {
    if (payload.method === "initialize") return rpc(id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "elias-vercel-mcp", version: "1.1.0" } });
    if (payload.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
    if (payload.method === "tools/list") return rpc(id, { tools });
    if (payload.method === "tools/call") { const params = payload.params || {}; const name = typeof params.name === "string" ? params.name : ""; const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {}; const result = await callTool(session.vercelApiToken, name, args); return rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result }); }
    return failure(id, -32601, `Unsupported MCP method '${payload.method || ""}'.`);
  } catch (error) { return failure(id, -32002, error instanceof Error ? error.message : "Vercel MCP request failed.", 502); }
}
