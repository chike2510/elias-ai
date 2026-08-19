export type ConnectorCategory = "app" | "custom_api" | "custom_mcp";
export type ConnectorAuth = "oauth" | "token" | "none" | "endpoint";

export type ConnectorDefinition = {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  auth: ConnectorAuth;
  icon: string;
  href?: string;
  status: "available" | "planned";
  tools: string[];
  permissions: string[];
  contributor: { name: string; kind: "official" | "community" };
};

export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  { id: "github", name: "GitHub", category: "app", description: "Repositories, files, branches, issues, and pull requests.", auth: "oauth", icon: "github", href: "/connectors/github", status: "available", tools: ["repositories.read", "files.read", "branch.create", "commit.create", "issue.create", "pull_request.create"], permissions: ["Repository read", "Branch writes", "Pull-request writes"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "vercel", name: "Vercel", category: "app", description: "Projects, deployments, logs, redeploys, and environment updates.", auth: "token", icon: "vercel", href: "/connectors/vercel", status: "available", tools: ["projects.read", "deployments.read", "deployment.redeploy", "environment.update"], permissions: ["Project read", "Deployment writes", "Environment writes"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "google-drive", name: "Google Drive", category: "app", description: "Search and use files from Drive as working context.", auth: "oauth", icon: "drive", status: "planned", tools: ["files.search", "files.read"], permissions: ["Drive read"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "notion", name: "Notion", category: "app", description: "Search pages and use workspace knowledge in tasks.", auth: "token", icon: "notion", status: "planned", tools: ["pages.search", "pages.read"], permissions: ["Workspace read"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "slack", name: "Slack", category: "app", description: "Find conversations and prepare team updates for approval.", auth: "oauth", icon: "slack", status: "planned", tools: ["messages.search", "message.prepare"], permissions: ["Message read", "Message write approval"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "custom-api", name: "Custom API", category: "custom_api", description: "Add a REST or GraphQL endpoint with an explicit tool contract.", auth: "endpoint", icon: "api", status: "available", tools: ["custom.request"], permissions: ["Endpoint URL", "Request approval"], contributor: { name: "Elias Core", kind: "official" } },
  { id: "custom-mcp", name: "Custom MCP", category: "custom_mcp", description: "Connect an MCP server and review its exposed tools before enabling them.", auth: "endpoint", icon: "mcp", status: "available", tools: ["mcp.discover", "mcp.execute"], permissions: ["Server endpoint", "Tool execution approval"], contributor: { name: "Elias Core", kind: "official" } },
];

export function categoryLabel(category: ConnectorCategory) {
  return category === "app" ? "Apps" : category === "custom_api" ? "Custom API" : "Custom MCP";
}

export function connectorIcon(icon: string) {
  return icon === "github" ? "github" : icon === "vercel" ? "vercel" : icon;
}
