import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processDocument } from "@/lib/documentPipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function redirectToChat(request: NextRequest, values: Record<string, string>) {
  const url = new URL("/chat", request.url);
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value.slice(0, 12000));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/share" + request.nextUrl.search)}`, request.url));
  const { searchParams } = request.nextUrl;
  const title = searchParams.get("title") || "Shared page";
  const text = searchParams.get("text") || "";
  const url = searchParams.get("url") || "";
  const prompt = `Review this shared item and help me understand it.\n\nTitle: ${title}\nURL: ${url}\nShared text:\n${text}`;
  return redirectToChat(request, { prompt, ...(url ? { sourceUrl: url } : {}) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/share")}`, request.url));
  const form = await request.formData();
  const title = String(form.get("title") || "Shared item").slice(0, 300);
  const text = String(form.get("text") || "").slice(0, 12000);
  const sourceUrl = String(form.get("url") || "").slice(0, 2000);
  const shared = form.get("files");
  if (shared instanceof File && shared.size > 0) {
    if (shared.size > MAX_UPLOAD_BYTES) return new NextResponse("Shared file is too large.", { status: 413 });
    const document = await processDocument(Buffer.from(await shared.arrayBuffer()), shared.name || title, shared.type || "application/octet-stream");
    const extracted = document.summary || document.chunks.map((chunk) => chunk.summary || chunk.text.slice(0, 900)).join("\n\n");
    const prompt = `Review the shared document and explain the important points.\n\nShared title: ${title}\n${text}\n\nExtracted document context:\n${extracted.slice(0, 24000)}`;
    return redirectToChat(request, { prompt, ...(sourceUrl ? { sourceUrl } : {}) });
  }
  const prompt = `Review this shared item and help me understand it.\n\nTitle: ${title}\nURL: ${sourceUrl}\nShared text:\n${text}`;
  return redirectToChat(request, { prompt, ...(sourceUrl ? { sourceUrl } : {}) });
}
