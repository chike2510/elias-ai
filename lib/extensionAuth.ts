import { createHmac, timingSafeEqual } from "node:crypto";
import type { EliasSession } from "@/lib/auth";

export type VerifiedExtensionToken = { sub: string; login?: string; exp: number };

function secret() {
  const configuredSecret = process.env.ELIAS_EXTENSION_SECRET || process.env.ELIAS_SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!configuredSecret || Buffer.byteLength(configuredSecret) < 32)) {
    throw new Error("ELIAS_EXTENSION_SECRET or ELIAS_SESSION_SECRET must be configured with at least 32 bytes in production.");
  }
  return configuredSecret || "local-development-extension-secret-change-me";
}
function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }

export function createExtensionToken(session: EliasSession, ttlSeconds = 60 * 60 * 24 * 30) {
  const payload = encode(JSON.stringify({ sub: session.userId, login: session.login, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(payload)}`;
}

export function verifyExtensionToken(value: string | null): VerifiedExtensionToken | null {
  try {
    if (!value) return null;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; login?: unknown; exp?: unknown };
    if (typeof parsed.sub !== "string" || !parsed.sub.trim() || typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { sub: parsed.sub, login: typeof parsed.login === "string" ? parsed.login : undefined, exp: parsed.exp };
  } catch { return null; }
}

export function extensionTokenFromRequest(request: Request) {
  const header = request.headers.get("authorization") || "";
  return verifyExtensionToken(header.startsWith("Bearer ") ? header.slice(7) : null);
}
