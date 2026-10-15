import type { ToolSchema } from "@/lib/assistant/llm";
import type { ToolContext } from "@/lib/assistant/tools";
import { addServer, callTool, listServers, MCP_PRESETS, mcpCallIsWrite, refreshTools, serverTools } from "@/lib/assistant/mcp";

type Args = Record<string, unknown>;
type Tool = { schema: ToolSchema["function"]; needsApproval?: (args: Args, ctx: ToolContext) => Promise<string | null> | string | null; run: (args: Args, ctx: ToolContext) => Promise<unknown> };
const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });
const base = () => (process.env.ELIAS_PUBLIC_URL || "https://elias-ai-chi.vercel.app").replace(/\/$/, "");

export const MCP_TOOLS: Record<string, Tool> = {
  mcp_servers: {
    schema: { name: "mcp_servers", description: "List the MCP servers (extra tool providers) the user connected, and the presets that can be connected: Football Charts (fixtures, model probabilities), Tavily (web search), APIfootball (bookmaker odds), Supabase (read-only DB), Transcriptor (video transcripts), KinoPipe (FFmpeg editing).", parameters: obj({}) },
    run: async (_args, ctx) => {
      const connected = await listServers(ctx.userId);
      return { connected: connected.map(({ id, name, status, toolCount }) => ({ id, name, status, tools: toolCount })), presets: MCP_PRESETS.filter((preset) => !connected.some((item) => item.preset === preset.id)).map(({ id, name, adds, auth, note }) => ({ id, name, adds, auth, note })) };
    },
  },
  mcp_connect: {
    schema: { name: "mcp_connect", description: "Connect an MCP server: a preset id from mcp_servers, or any https MCP URL. Key-based servers show the user a secure key form in the chat; OAuth servers show a sign-in link; open servers connect at once. Never ask for keys in chat.", parameters: obj({ preset: s("Preset id, e.g. tavily"), url: s("Custom MCP server URL (https)"), name: s("Name for a custom server") }) },
    run: async (args, ctx) => {
      const preset = MCP_PRESETS.find((item) => item.id === str(args.preset));
      if (preset?.auth === "unsupported") return { connected: false, reason: preset.note };
      if (preset?.auth === "key") {
        ctx.addCard?.({ kind: "secret_form", purpose: "mcp", title: `Connect ${preset.name}`, preset: preset.id, label: preset.keyLabel || "API key", help: preset.keyHelp, getKeyUrl: preset.keyUrl });
        return { shown: "key_form", tell_user: `A secure form for the ${preset.keyLabel} is showing in the chat${preset.keyUrl ? ` (they get the key at ${preset.keyUrl})` : ""}. When they save it, you'll get a message.` };
      }
      const added = await addServer(ctx.userId, { preset: preset?.id, url: str(args.url), name: str(args.name) });
      if (added.status === "needs_auth") {
        const link = `${base()}/api/mcp/oauth/start?server=${encodeURIComponent(added.id)}`;
        ctx.addCard?.({ kind: "links", title: `Sign in to ${added.name}`, items: [{ title: `Connect ${added.name}`, url: link, snippet: "Sign in once; Elias keeps the access encrypted." }] });
        return { status: "needs_sign_in", link, tell_user: "A sign-in link is showing in the chat. After they sign in, the tools are ready." };
      }
      const tools = await serverTools(ctx.userId, added.id).catch((error) => ({ tools: [], error: String(error) }));
      return { connected: true, id: added.id, name: added.name, tools: (tools.tools || []).map((tool) => tool.name) };
    },
  },
  mcp_tools: {
    schema: { name: "mcp_tools", description: "List a connected MCP server's tools with their input schemas, so you can call one with mcp_call.", parameters: obj({ server: s("Server id or name"), refresh: { type: "boolean" } }, ["server"]) },
    run: async (args, ctx) => {
      const result = args.refresh ? { tools: await refreshTools(ctx.userId, str(args.server)) } : await serverTools(ctx.userId, str(args.server));
      return result.tools.slice(0, 60).map((tool) => ({ name: tool.name, description: (tool.description || "").slice(0, 300), input: JSON.stringify(tool.inputSchema || {}).slice(0, 900) }));
    },
  },
  mcp_call: {
    schema: { name: "mcp_call", description: "Call a tool on a connected MCP server. Read tools run at once; tools that upload, write, delete, send or edit wait for the user's approval.", parameters: obj({ server: s("Server id or name"), tool: s("Tool name from mcp_tools"), arguments: { type: "object", description: "Tool arguments matching its input schema" } }, ["server", "tool"]) },
    needsApproval: (args, ctx) => ctx.approved || !mcpCallIsWrite(str(args.tool)) ? null : `Run ${str(args.tool)} on ${str(args.server)}\n${JSON.stringify(args.arguments || {}).slice(0, 600)}`,
    run: async (args, ctx) => callTool(ctx.userId, str(args.server), str(args.tool), (args.arguments || {}) as Record<string, unknown>),
  },
};
