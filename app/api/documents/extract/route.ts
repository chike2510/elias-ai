import { NextRequest } from "next/server";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("file is required", 400, "INVALID_REQUEST");
    if (file.size > MAX_UPLOAD_BYTES) return jsonError("file is too large", 413, "PAYLOAD_TOO_LARGE");

    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = file.name.toLowerCase().split(".").pop() || "";
    let text = "";
    if (extension === "pdf") text = (await pdf(buffer)).text;
    else if (extension === "docx") text = (await mammoth.extractRawText({ buffer })).value;
    else if (["xlsx", "xls", "csv"].includes(extension)) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      text = workbook.SheetNames.map((name) => `## ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n");
    } else text = buffer.toString("utf8");

    return jsonOk({ name: file.name, text: text.slice(0, 350_000), chars: text.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Document extraction failed.");
  }
}
