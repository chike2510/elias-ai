import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Secrets at rest (OAuth access/refresh tokens, GitHub tokens): AES-256-GCM.
 *
 * Current format:  "v2:" + base64url(iv) "." base64url(tag) "." base64url(ciphertext), keyed by ELIAS_ENCRYPTION_KEY.
 * Legacy formats still read (and re-encrypted on the next write):
 *   - "iv.tag.data" keyed by sha256("elias-assistant:" + ELIAS_SESSION_SECRET)   (assistant tokens, v2 app)
 *   - "iv.tag.data" keyed by sha256(ELIAS_SESSION_SECRET)                        (GitHub connection store)
 *   - plaintext (anything that is not one of the above)
 */
const PREFIX = "v2:";
const DEV_SECRET = "local-development-secret-change-me";

function encryptionKey() {
  const raw = process.env.ELIAS_ENCRYPTION_KEY;
  if (!raw) return null;
  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  // Accept a 32-byte key in hex/base64; anything else is stretched with sha256 so a passphrase still works.
  return decoded.length === 32 ? decoded : createHash("sha256").update(raw).digest();
}

function legacyKeys() {
  const session = process.env.ELIAS_SESSION_SECRET || DEV_SECRET;
  return [createHash("sha256").update(`elias-assistant:${session}`).digest(), createHash("sha256").update(session).digest()];
}

function seal(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

function open(value: string, key: Buffer) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || data === undefined) throw new Error("Not an encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptionConfigured() {
  return Boolean(process.env.ELIAS_ENCRYPTION_KEY);
}

/** Encrypts with ELIAS_ENCRYPTION_KEY (v2). Without it (local dev/tests) falls back to the legacy session-derived key. */
export function encryptSecret(value: string) {
  const key = encryptionKey();
  return key ? PREFIX + seal(value, key) : seal(value, legacyKeys()[0]);
}

/** Reads every format we have ever written, including plaintext rows from before encryption. */
export function decryptSecret(value: string) {
  if (value.startsWith(PREFIX)) {
    const key = encryptionKey();
    if (!key) throw new Error("ELIAS_ENCRYPTION_KEY is not set, so stored tokens can't be read.");
    return open(value.slice(PREFIX.length), key);
  }
  if (/^[\w-]{16}\.[\w-]{22}\.[\w-]*$/.test(value)) {
    for (const key of legacyKeys()) { try { return open(value, key); } catch { /* try the next key */ } }
    throw new Error("Stored secret can't be decrypted with the current keys.");
  }
  return value; // plaintext row
}

/** True when a stored value should be rewritten in the current format. */
export function needsReencrypt(value: string | null | undefined) {
  return Boolean(value) && Boolean(encryptionKey()) && !String(value).startsWith(PREFIX);
}
