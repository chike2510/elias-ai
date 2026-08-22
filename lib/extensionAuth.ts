import { createHmac, timingSafeEqual } from "node:crypto";
import type { EliasSession } from "@/lib/auth";

function secret() { return process.env.ELIAS_EXTENSION_SECRET || process.env.ELIAS_SESSION_SECRET || "local-development-extension-secret-change-me"; }
function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }

export function createExtensionToken(session: EliasSession, ttlSeconds = 60 * 60 * 24 * 30) {
  const payload = encode(JSON.stringify({ sub: session.userId, login: session.login, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(payload)}`;
}

export function verifyExtensionToken(value: string | null) {
  try {
    if (!value) return null;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; login?: string; exp?: number };
    return parsed.sub && parsed.exp && parsed.exp > Math.floor(Date.now() / 1000) ? parsed : null;
  } catch { return null; }
}

export function extensionTokenFromRequest(request: Request) {
  const header = request.headers.get("authorization") || "";
  return verifyExtensionToken(header.startsWith("Bearer ") ? header.slice(7) : null);
}
