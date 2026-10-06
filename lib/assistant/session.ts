import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";
import { jsonError } from "@/lib/http";

export async function requireUser() {
  const session = await getSession();
  if (!session) return { error: jsonError("Sign in to use Elias.", 401, "UNAUTHENTICATED") } as const;
  const githubToken = await getGitHubToken(session).catch(() => undefined);
  return { session, userId: session.userId, userName: session.name || session.login, githubToken } as const;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
