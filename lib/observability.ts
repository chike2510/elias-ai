/**
 * Optional error tracking. With SENTRY_DSN set, errors are sent to Sentry's envelope endpoint
 * (no SDK, no build plugin). Without it, errors are written as one structured JSON line.
 */
type Context = Record<string, unknown>;

function parseDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!url.username || !projectId) return null;
    return { key: url.username, host: url.host, protocol: url.protocol, projectId };
  } catch { return null; }
}

export function errorTrackingEnabled() {
  return Boolean(process.env.SENTRY_DSN && parseDsn(process.env.SENTRY_DSN));
}

export function logError(error: unknown, context: Context = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(JSON.stringify({ level: "error", at: new Date().toISOString(), message: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 8).join("\n"), ...context }));
}

export async function captureError(error: unknown, context: Context = {}) {
  logError(error, context);
  const dsn = process.env.SENTRY_DSN ? parseDsn(process.env.SENTRY_DSN) : null;
  if (!dsn) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId, timestamp: Date.now() / 1000, platform: "node", level: "error",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV, release: process.env.VERCEL_GIT_COMMIT_SHA,
    exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: (err.stack || "").split("\n").slice(1, 20).reverse().map((line) => ({ function: line.trim() })) } }] },
    tags: Object.fromEntries(Object.entries(context).filter(([, value]) => typeof value === "string").slice(0, 10)),
    extra: context,
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  await fetch(`${dsn.protocol}//${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.key}&sentry_version=7`, { method: "POST", body, headers: { "Content-Type": "application/x-sentry-envelope" }, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
}
