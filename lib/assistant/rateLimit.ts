import { hasDb, ready } from "@/lib/assistant/db";

/** Sliding-window limits per bucket. Postgres-backed so every serverless instance shares them; memory fallback. */
export const LIMITS = {
  chat: { limit: 20, windowMs: 60_000 },
  approve: { limit: 30, windowMs: 60_000 },
  import: { limit: 30, windowMs: 3_600_000 },
  read: { limit: 240, windowMs: 60_000 },
  ip: { limit: 120, windowMs: 60_000 },
} as const;
export type LimitName = keyof typeof LIMITS;

declare global { var __eliasRateMemory: Map<string, number[]> | undefined; }

function memoryHit(bucket: string, limit: number, windowMs: number) {
  const store: Map<string, number[]> = (globalThis.__eliasRateMemory ||= new Map<string, number[]>());
  const now = Date.now();
  const hits = (store.get(bucket) || []).filter((at) => at > now - windowMs);
  if (hits.length >= limit) { store.set(bucket, hits); return { ok: false, retryAfter: Math.ceil((hits[0] + windowMs - now) / 1000) }; }
  hits.push(now);
  store.set(bucket, hits);
  return { ok: true, retryAfter: 0 };
}

export async function rateLimit(bucket: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
  if (!hasDb()) return memoryHit(bucket, limit, windowMs);
  try {
    const db = await ready();
    const since = new Date(Date.now() - windowMs);
    const rows = await db`select count(*)::int as n, min(at) as oldest from public.elias_rate_events where bucket = ${bucket} and at > ${since}`;
    const count = Number(rows[0]?.n || 0);
    if (count >= limit) {
      const oldest = rows[0]?.oldest ? new Date(rows[0].oldest as string).getTime() : Date.now();
      return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000)) };
    }
    await db`insert into public.elias_rate_events (bucket) values (${bucket})`;
    if (Math.random() < 0.02) await db`delete from public.elias_rate_events where at < now() - interval '2 hours'`.catch(() => undefined);
    return { ok: true, retryAfter: 0 };
  } catch {
    return memoryHit(bucket, limit, windowMs);
  }
}

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local").split(",")[0].trim();
}

/** Checks the user's bucket and the caller's IP bucket. */
export async function checkLimits(request: Request, userId: string, name: LimitName) {
  const rule = LIMITS[name];
  const user = await rateLimit(`u:${userId}:${name}`, rule.limit, rule.windowMs);
  if (!user.ok) return user;
  return rateLimit(`ip:${clientIp(request)}`, LIMITS.ip.limit, LIMITS.ip.windowMs);
}
