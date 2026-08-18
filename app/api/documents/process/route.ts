import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { processDocument } from "@/lib/documentPipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to process documents.", 401, "UNAUTHORIZED");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("file is required", 400, "INVALID_REQUEST");
    if (file.size > MAX_UPLOAD_BYTES) return jsonError("file is too large", 413, "PAYLOAD_TOO_LARGE");
    const document = await processDocument(Buffer.from(await file.arrayBuffer()), file.name, file.type || "application/octet-stream");
    const text = document.summary || document.chunks.map((chunk) => chunk.summary || chunk.text.slice(0, 900)).join("\n\n");
    return jsonOk({ document, text });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Document processing failed.");
  }
}
