import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";

const tools = [
  { name: "list_projects", description: "List Vercel projects visible to this user." },
  { name: "get_deployment", description: "Inspect a deployment by ID or hostname." },
  { name: "get_deployment_build_logs", description: "Read recent build events for a deployment." },
];

async function verifyVercelToken(token: string) {
  const response = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Vercel rejected this token." : `Vercel verification failed (${response.status}).`);
  const data = await response.json() as { user?: { id?: string; username?: string; name?: string } };
  return data.user || {};
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
    await setSession({ ...session, vercelApiToken: token, vercelConnected: true, vercelTeamId: user.id });
    return NextResponse.json({ connected: true, tools, account: { id: user.id, username: user.username, name: user.name }, message: `Connected to Vercel${user.username ? ` as @${user.username}` : ""}.` });
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
