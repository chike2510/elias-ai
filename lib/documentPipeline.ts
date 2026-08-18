import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { chooseProvider, completeWithProvider, pickModel } from "@/lib/providers";

export type DocumentChunk = {
  id: string;
  index: number;
  pageStart: number;
  pageEnd: number;
  text: string;
  summary?: string;
};

export type ProcessedDocument = {
  name: string;
  mimeType: string;
  pageCount: number;
  chars: number;
  truncated: boolean;
  chunks: DocumentChunk[];
  summary?: string;
  provider?: string;
  model?: string;
};

const MAX_EXTRACTED_CHARS = 1_000_000;
const CHUNK_TARGET_CHARS = 18_000;
const CHUNK_OVERLAP_CHARS = 1_500;

function makeChunkId(index: number) {
  return `chunk_${index + 1}_${crypto.randomUUID()}`;
}

function splitText(text: string, target = CHUNK_TARGET_CHARS, overlap = CHUNK_OVERLAP_CHARS) {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + target);
    const slice = text.slice(cursor, end);
    const boundary = end < text.length ? Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". ")) : slice.length;
    const actualEnd = end < text.length && boundary > target * 0.55 ? cursor + boundary + (slice[boundary] === "." ? 1 : 0) : end;
    chunks.push(text.slice(cursor, actualEnd).trim());
    if (actualEnd >= text.length) break;
    cursor = Math.max(actualEnd - overlap, cursor + 1);
  }
  return chunks.filter(Boolean);
}

function chunkPages(pages: Array<{ page: number; text: string }>): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let current = "";
  let pageStart = 1;
  let pageEnd = 1;
  const flush = () => {
    if (!current.trim()) return;
    const pieces = splitText(current);
    pieces.forEach((text, index) => chunks.push({ id: makeChunkId(chunks.length), index: chunks.length, pageStart, pageEnd, text: index === pieces.length - 1 ? text : text }));
    current = "";
  };
  for (const page of pages) {
    const next = current ? `${current}\n\n[Page ${page.page}]\n${page.text}` : `[Page ${page.page}]\n${page.text}`;
    if (next.length > CHUNK_TARGET_CHARS && current) flush();
    if (!current) pageStart = page.page;
    current += current ? `\n\n[Page ${page.page}]\n${page.text}` : `[Page ${page.page}]\n${page.text}`;
    pageEnd = page.page;
  }
  flush();
  return chunks;
}

async function extractPages(buffer: Buffer, extension: string) {
  if (extension !== "pdf") {
    if (extension === "docx") return [{ page: 1, text: (await mammoth.extractRawText({ buffer })).value }];
    if (["xlsx", "xls", "csv"].includes(extension)) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      return [{ page: 1, text: workbook.SheetNames.map((name) => `## ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n") }];
    }
    return [{ page: 1, text: buffer.toString("utf8") }];
  }
  const pages: Array<{ page: number; text: string }> = [];
  await pdf(buffer, {
    pagerender: async (pageData: { getTextContent: (options: { normalizeWhitespace: boolean }) => Promise<{ items: Array<{ str?: string }> }> }) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true });
      const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
      pages.push({ page: pages.length + 1, text });
      return text;
    },
  });
  return pages;
}

async function summarizeChunk(chunk: DocumentChunk, provider: string, model: string) {
  const response = await completeWithProvider({
    provider: provider as Parameters<typeof completeWithProvider>[0]["provider"],
    model,
    temperature: 0.15,
    messages: [
      { role: "system", content: "You summarize study documents precisely. Preserve definitions, claims, examples, formulas, and important qualifiers. Return concise notes with page references when present." },
      { role: "user", content: `Summarize this document section in 120-180 words.\n\n${chunk.text}` },
    ],
  });
  return response.text.trim();
}

async function summarizeDocument(chunks: DocumentChunk[]) {
  const provider = await chooseProvider("study", Math.min(10, 5 + Math.ceil(chunks.length / 3)));
  if (!provider) return { chunks, summary: undefined, provider: undefined, model: undefined };
  const model = await pickModel(provider, "study");
  if (!model) return { chunks, summary: undefined, provider, model: undefined };
  const enriched = [...chunks];
  for (let start = 0; start < enriched.length; start += 4) {
    const batch = enriched.slice(start, start + 4);
    const summaries = await Promise.all(batch.map((chunk) => summarizeChunk(chunk, provider, model).catch(() => "")));
    summaries.forEach((summary, index) => { if (summary) enriched[start + index] = { ...enriched[start + index], summary }; });
  }
  const digest = enriched.map((chunk) => `Pages ${chunk.pageStart}-${chunk.pageEnd}: ${chunk.summary || chunk.text.slice(0, 900)}`).join("\n\n");
  const final = await completeWithProvider({
    provider: provider as Parameters<typeof completeWithProvider>[0]["provider"],
    model,
    temperature: 0.15,
    messages: [
      { role: "system", content: "You synthesize a faithful study guide from section summaries. Organize the answer into overview, key concepts, important details, and revision questions. Do not invent information." },
      { role: "user", content: `Create a study guide for the complete document from these section summaries:\n\n${digest.slice(0, 90_000)}` },
    ],
  });
  return { chunks: enriched, summary: final.text.trim(), provider, model };
}

export async function processDocument(buffer: Buffer, name: string, mimeType: string): Promise<ProcessedDocument> {
  const extension = name.toLowerCase().split(".").pop() || "";
  const pages = await extractPages(buffer, extension);
  const raw = pages.map((page) => page.text).join("\n\n");
  const truncated = raw.length > MAX_EXTRACTED_CHARS;
  const cappedPages = truncated ? [{ page: 1, text: raw.slice(0, MAX_EXTRACTED_CHARS) }] : pages;
  const chunks = chunkPages(cappedPages);
  const summarized = await summarizeDocument(chunks);
  return { name, mimeType, pageCount: pages.length, chars: raw.length, truncated, chunks: summarized.chunks, summary: summarized.summary, provider: summarized.provider, model: summarized.model };
}
