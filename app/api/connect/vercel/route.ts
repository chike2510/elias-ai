import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";

const tools = [
  { name: "list_projects", description: "List Vercel projects visible to this user." },
  { name: "get_deployment", description: "Inspect a deployment by ID or hostname." },
  { name: "get_deployment_build_logs", description: "Read recent build events for a deployment." },
];

async function verifyVercelToken(token: string) {
  // Project- and team-scoped tokens are intentionally denied access to /v2/user.
  // Validate against a project resource instead; Vercel infers scope from the token.
  const response = await fetch("https://api.vercel.com/v9/projects?limit=1", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Vercel could not find an accessible project for this token. Create a Full Account, Team, or Project token at Vercel Account Settings → Tokens; do not paste VERCEL_MCP_TOKEN or the oac_ OAuth Client ID.");
    if (response.status === 401) throw new Error("Vercel rejected this token. Check that it is active and copied completely.");
    throw new Error(`Vercel verification failed (${response.status}).`);
  }
  const data = await response.json() as { projects?: Array<{ id?: string; name?: string; accountId?: string }> };
  return { projects: data.projects || [] };
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to connect Vercel." }, { status: 401 });
  let body: { token?: string } = {};
  try { body = await request.json() as { token?: string }; } catch { /* token may already exist in the session */ }
  const token = body.token?.trim() || session.vercelApiToken || "";
  if (!token) return NextResponse.json({ needsToken: true, connected: false, tools: [], message: "Paste your Vercel API token to connect this Elias account." }, { status: 400 });

  try {
    const user = await verifyVercelToken(token);
    await setSession({ ...session, vercelApiToken: token, vercelConnected: true, vercelTeamId: undefined });
    const firstProject = user.projects[0];
    return NextResponse.json({ connected: true, tools, account: { projectCount: user.projects.length, sampleProject: firstProject?.name }, message: `Connected to Vercel${firstProject?.name ? ` with access to ${firstProject.name}` : ""}.` });
  } catch (error) {
    return NextResponse.json({ connected: false, tools: [], message: error instanceof Error ? error.message : "Vercel connection failed." }, { status: 502 });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { vercelApiToken: _token, vercelConnected: _connected, vercelTeamId: _team, ...rest } = session;
  await setSession(rest);
  return NextResponse.json({ connected: false });
}
