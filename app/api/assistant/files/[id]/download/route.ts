import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { getFile, getFileData } from "@/lib/assistant/files";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** GET the original file when it was kept, otherwise its extracted text as a .txt. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const original = await getFileData(auth.userId, id);
    const safe = (name: string) => encodeURIComponent(name.replace(/["\\]/g, ""));
    // ?inline=1 shows images in place (Studio gallery); everything else downloads.
    const inline = request.nextUrl.searchParams.get("inline") === "1" && /^image\/(png|jpeg|webp|gif)$/.test(original?.mime || "");
    if (original) return new NextResponse(new Uint8Array(original.data), { headers: { "Content-Type": original.mime || "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safe(original.name)}`, "Cache-Control": inline ? "private, max-age=86400" : "private, no-store", "X-Content-Type-Options": "nosniff" } });
    const file = await getFile(auth.userId, id);
    if (!file) return jsonError("File not found.", 404, "NOT_FOUND");
    const name = `${file.name.replace(/\.[^.]+$/, "")}.txt`;
    return new NextResponse(file.text || "", { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${safe(name)}`, "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(reportError(error, "assistant/files/download", auth.userId)); }
}
