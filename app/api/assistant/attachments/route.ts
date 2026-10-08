import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { hasDb, ready } from "@/lib/assistant/db";
import { extractDocumentText } from "@/lib/documentPipeline";
import { saveFile } from "@/lib/assistant/files";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10_500_000;
const MAX_PART_BYTES = 3_600_000; // under Vercel's 4.5 MB request body cap
const MAX_TEXT_CHARS = 60_000;
const TEXT_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "markdown", "json", "html", "htm", "xml", "rtf", "log", "yaml", "yml", "tsv", "ts", "tsx", "js", "jsx", "py", "java", "go", "rs", "sql", "css", "ini", "toml", "srt", "vtt"]);

const MIME: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", htm: "text/html" };
function mimeFor(extension: string) { return MIME[extension] || "text/plain"; }

let partsTable: Promise<void> | undefined;
async function partsDb() {
  const db = await ready();
  partsTable ||= (async () => {
    await db`create table if not exists public.elias_upload_parts (
      upload_id text not null, user_id text not null, idx int not null, data bytea not null,
      created_at timestamptz not null default now(), primary key (user_id, upload_id, idx))`;
  })().catch((error) => { partsTable = undefined; throw error; });
  await partsTable;
  return db;
}

/**
 * POST raw file bytes (application/octet-stream) -> extracted text for the chat.
 * Query: name, size, and for files over ~3.5 MB: upload (client id), part (0-based), parts.
 * Earlier parts are parked in Postgres; the last part assembles, extracts and deletes them.
 * The extracted file is also saved to the user's Library (elias_files): `save=library` marks a Library upload
 * (original bytes kept up to 5 MB), otherwise it is saved as a chat attachment (text only). `save=0` skips it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "read");
  if ("error" in auth) return auth.error;
  const params = request.nextUrl.searchParams;
  const name = (params.get("name") || "file").replace(/[\u0000-\u001f<>]/g, "").slice(0, 120);
  const extension = name.toLowerCase().split(".").pop() || "";
  if (!TEXT_EXTENSIONS.has(extension)) return jsonError(`Elias can't read .${extension} files yet. Try PDF, Word (.docx), Excel (.xlsx), CSV or text.`, 415, "UNSUPPORTED");
  const parts = Math.max(1, Math.min(4, Number(params.get("parts") || 1) || 1));
  const part = Math.max(0, Math.min(parts - 1, Number(params.get("part") || 0) || 0));
  const upload = params.get("upload") || "";
  if (parts > 1 && !/^[A-Za-z0-9_-]{8,40}$/.test(upload)) return jsonError("Bad upload id.", 400, "BAD_REQUEST");
  try {
    const chunk = Buffer.from(await request.arrayBuffer());
    if (!chunk.length) return jsonError("The file was empty.", 400, "BAD_REQUEST");
    if (chunk.length > MAX_PART_BYTES) return jsonError("Upload part too large.", 413, "PAYLOAD_TOO_LARGE");
    let buffer = chunk;
    if (parts > 1) {
      if (!hasDb()) return jsonError("Large files need the database.", 503, "NOT_CONFIGURED");
      const db = await partsDb();
      await db`delete from public.elias_upload_parts where created_at < now() - interval '1 hour'`;
      if (part < parts - 1) {
        await db`insert into public.elias_upload_parts (upload_id, user_id, idx, data) values (${upload}, ${auth.userId}, ${part}, ${chunk}) on conflict (user_id, upload_id, idx) do update set data = excluded.data, created_at = now()`;
        return jsonOk({ stored: part });
      }
      const rows = await db`select idx, data from public.elias_upload_parts where user_id = ${auth.userId} and upload_id = ${upload} order by idx`;
      await db`delete from public.elias_upload_parts where user_id = ${auth.userId} and upload_id = ${upload}`;
      if (rows.length !== parts - 1) return jsonError("Part of the file went missing. Attach it again.", 409, "INCOMPLETE");
      buffer = Buffer.concat([...rows.map((row) => Buffer.from(row.data as Uint8Array)), chunk]);
    }
    if (buffer.length > MAX_FILE_BYTES) return jsonError("Files can be up to 10 MB.", 413, "PAYLOAD_TOO_LARGE");
    const { text, pageCount } = await extractDocumentText(buffer, name);
    const clean = text.replace(/\u0000/g, "");
    const save = params.get("save");
    let fileId: string | null = null;
    if (save !== "0" && hasDb() && clean.trim()) {
      const library = save === "library";
      fileId = await saveFile(auth.userId, { name, mime: params.get("mime") || mimeFor(extension), size: buffer.length, kind: library ? "upload" : "attachment", text: clean, pageCount, data: library ? buffer : null, conversationId: params.get("conversationId") })
        .then((file) => file.id).catch((error) => { reportError(error, "assistant/attachments:save", auth.userId); return null; });
    }
    return jsonOk({ name, size: buffer.length, pageCount, chars: clean.length, text: clean.slice(0, MAX_TEXT_CHARS), truncated: clean.length > MAX_TEXT_CHARS, fileId });
  } catch (error) {
    return jsonError(`Couldn't read ${name}: ${reportError(error, "assistant/attachments", auth.userId)}`, 422, "EXTRACT_FAILED");
  }
}
