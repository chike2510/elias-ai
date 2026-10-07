/** Next.js server hook: every unhandled request error goes through the optional tracker. */
export async function register() { /* nothing to initialise: tracking is env-gated per call */ }

export async function onRequestError(error: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureError } = await import("@/lib/observability");
  await captureError(error, { path: request.path, method: request.method, route: context.routePath, routeType: context.routeType });
}
