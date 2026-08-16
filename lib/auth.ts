import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export type EliasSession = {
  userId: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  githubToken?: string;
  githubConnected?: boolean;
  vercelApiToken?: string;
  vercelConnected?: boolean;
  vercelTeamId?: string;
  createdAt: number;
};

const COOKIE_NAME = "elias_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function key() {
  return createHash("sha256").update(process.env.ELIAS_SESSION_SECRET || "local-development-secret-change-me").digest();
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function seal(session: EliasSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => encode(part.toString("base64url"))).join(".");
}

function unseal(value: string): EliasSession | null {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(decode(ivValue), "base64url"));
    decipher.setAuthTag(Buffer.from(decode(tagValue), "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(decode(encryptedValue), "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted) as EliasSession;
  } catch {
    return null;
  }
}

export async function getSession() {
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  return value ? unseal(value) : null;
}

export async function setSession(session: EliasSession) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, seal(session), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export function oauthRedirectUri(request: Request, provider: "github" | "vercel") {
  const origin = new URL(request.url).origin;
  return `${origin}/api/auth/${provider}/callback`;
}

export function githubConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function publicOrigin(request: Request) {
  return (process.env.ELIAS_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
}
