import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

/**
 * Best-effort, bounded, per-process burst throttling only—not robust production
 * abuse protection. Multi-instance deployments need a trusted edge or shared
 * store to enforce a durable/global quota.
 */
export function takeRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const key = `${scope}:${identity}`;
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > MAX_BUCKETS) {
    for (const [candidate, value] of buckets) {
      if (value.resetAt <= now || buckets.size > MAX_BUCKETS) buckets.delete(candidate);
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Use the authenticated account where available, otherwise a reverse-proxy client address. */
export function requestRateLimitIdentity(request: Request, userId?: string) {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return `ip:${(forwarded || realIp || "unknown").slice(0, 128)}`;
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please retry later.",
        details: { retryAfterSeconds },
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
