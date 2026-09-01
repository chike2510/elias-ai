import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubConnection } from "@/lib/githubConnectionStore";
import { vercelMcpConfigured } from "@/lib/vercelMcp";

export async function GET() {
  const session = await getSession();
  const githubConnection = session ? await getGitHubConnection(session.userId).catch(() => undefined) : undefined;
  return NextResponse.json({
    user: session
      ? {
          userId: session.userId,
          login: session.login,
          name: session.name,
          email: session.email,
          avatarUrl: session.avatarUrl,
          githubConnected: Boolean(githubConnection),
          vercelConnected: Boolean(session.vercelConnected),
          vercelAccount: session.vercelConnected ? { teamId: session.vercelTeamId } : null,
          vercelMcpConfigured: vercelMcpConfigured(),
        }
      : null,
  });
}
