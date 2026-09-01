import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";
import { deleteGitHubConnection } from "@/lib/githubConnectionStore";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ connected: false, message: "Sign in to Elias first." }, { status: 401 });

  await deleteGitHubConnection(session.userId).catch(() => undefined);
  const { githubToken: _githubToken, githubConnected: _githubConnected, ...rest } = session;
  await setSession(rest);
  return NextResponse.json({ connected: false });
}
