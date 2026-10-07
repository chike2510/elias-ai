import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";
import { jsonError } from "@/lib/http";
import { checkLimits, type LimitName } from "@/lib/assistant/rateLimit";
import { captureError } from "@/lib/observability";

/** Auth + per-user/IP rate limit for every /api/assistant route. */
export async function requireUser(request?: Request, limit: LimitName = "read") {
  const session = await getSession();
  if (!session) return { error: jsonError("Sign in to use Elias.", 401, "UNAUTHENTICATED") } as const;
  if (request) {
    const verdict = await checkLimits(request, session.userId, limit);
    if (!verdict.ok) {
      const response = jsonError(`You're going a bit fast. Try again in ${verdict.retryAfter}s.`, 429, "RATE_LIMITED", { retryAfter: verdict.retryAfter });
      response.headers.set("Retry-After", String(verdict.retryAfter));
      return { error: response as NextResponse } as const;
    }
  }
  const githubToken = await getGitHubToken(session).catch(() => undefined);
  return { session, userId: session.userId, userName: session.name || session.login, githubToken } as const;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Logs (and, when SENTRY_DSN is set, reports) a route failure, then returns the user-facing message. */
export function reportError(error: unknown, route: string, userId?: string) {
  void captureError(error, { route, userId });
  return errorMessage(error);
}
