import { lookup } from "node:dns/promises";

const MAX_SOURCE_CHARS = 30_000;
const SEARCH_TIMEOUT_MS = 5_000;

function clean(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertSafeUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("A valid URL is required.");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (parsed.username || parsed.password) throw new Error("URLs with embedded credentials are not allowed.");
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "metadata.google.internal" || isPrivateIpv4(hostname) || hostname === "::1") {
    throw new Error("Private or local network URLs are not allowed.");
  }
  try {
    const records = await lookup(hostname, { all: true });
    if (records.some((record) => isPrivateIpv4(record.address) || record.address === "::1" || record.address.startsWith("fc") || record.address.startsWith("fd"))) {
      throw new Error("Private or local network URLs are not allowed.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Private or local")) throw error;
  }
  return parsed;
}

async function readBounded(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!/(text\/html|text\/plain|application\/json|application\/xhtml)/i.test(contentType)) {
    throw new Error("The source is not a readable text or HTML document.");
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 1_500_000) throw new Error("The source is too large to read safely.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 1_500_000) throw new Error("The source is too large to read safely.");
  return new TextDecoder().decode(buffer);
}

export async function searchWeb(query: string) {
  const value = query.trim();
  if (!value) return [];
  const encoded = encodeURIComponent(value.slice(0, 300));
  const searchUrls = [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://www.google.com/search?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}`,
  ];

  for (const url of searchUrls) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ELIAS research agent/1.0)", Accept: "text/html,application/xhtml+xml" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const html = await response.text();
      const output: Array<{ title: string; url: string; source: string }> = [];
      const links = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = links.exec(html)) && output.length < 40) {
        let href = match[1];
        if (href.includes("uddg=")) {
          try { href = decodeURIComponent(new URL(href, "https://www.google.com").searchParams.get("uddg") || href); } catch { /* keep original */ }
        }
        if (href.includes("u=a1")) {
          try {
            const encodedTarget = new URL(href.replaceAll("&amp;", "&"), "https://www.bing.com").searchParams.get("u")?.slice(2);
            if (encodedTarget) href = Buffer.from(encodedTarget, "base64").toString("utf8");
          } catch { /* keep Bing redirect only as a last resort */ }
        }
        const title = clean(match[2]);
        if (title.length > 8 && /^https?:\/\//i.test(href) && !/(duckduckgo|google\.|bing\.)/i.test(href)) {
          try {
            const parsed = await assertSafeUrl(href);
            output.push({ title, url: parsed.toString(), source: parsed.hostname });
          } catch {
            // Search engines may include tracking or local links; skip them.
          }
        }
      }
      const terms = value.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
      const unique = output.filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index)
        .map((item) => ({ item, score: terms.reduce((score, term) => score + (`${item.title} ${item.url} ${item.source}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item)
        .slice(0, 10);
      if (unique.length) return unique;
    } catch {
      // Fall through to the next search provider.
    }
  }
  return [];
}

export async function fetchUrl(value: string) {
  const parsed = await assertSafeUrl(value);
  const response = await fetch(parsed, {
    headers: { "User-Agent": "ELIAS research agent/1.0", Accept: "text/html,text/plain,application/xhtml+xml,application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`URL returned ${response.status}`);
  return clean(await readBounded(response)).slice(0, MAX_SOURCE_CHARS);
}
