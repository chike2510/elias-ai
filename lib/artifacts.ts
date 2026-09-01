import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import pptxgen from "pptxgenjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { format } from "prettier";
import { unified } from "unified";
import remarkParse from "remark-parse";

type PdfBlock = { kind: "title" | "heading" | "body" | "bullet" | "numbered" | "quote" | "spacer"; text: string; level?: number };
type PdfWord = { text: string; bold?: boolean; code?: boolean };

function stripHtml(value: string) {
  let output = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<") { insideTag = true; continue; }
    if (character === ">") { insideTag = false; continue; }
    if (!insideTag) output += character;
  }
  return output;
}

function decodeEntities(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");
}

function cleanPdfText(value: string) {
  return decodeEntities(stripHtml(value)).replaceAll(String.fromCharCode(160), " ").trim();
}

function markdownBlocks(content: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { const text = cleanPdfText(paragraph.join(" ")); if (text) blocks.push({ kind: "body", text }); paragraph = []; };
  for (const raw of content.replaceAll(String.fromCharCode(13), "").split(String.fromCharCode(10))) {
    const rawLine = raw.trim();
    if (!rawLine) { flush(); if (blocks.at(-1)?.kind !== "spacer") blocks.push({ kind: "spacer", text: "" }); continue; }
    const htmlHeading = rawLine.match(new RegExp("^<h([1-6])[^>]*>(.*)</h[1-6]>$", "i"));
    if (htmlHeading) { flush(); blocks.push({ kind: htmlHeading[1] === "1" ? "title" : "heading", level: Number(htmlHeading[1]), text: cleanPdfText(htmlHeading[2]) }); continue; }
    const htmlBullet = rawLine.match(new RegExp("^<li[^>]*>(.*)</li>$", "i"));
    if (htmlBullet) { flush(); blocks.push({ kind: "bullet", text: cleanPdfText(htmlBullet[1]) }); continue; }
    const markdownHeading = rawLine.match(/^(#+) +(.*)$/);
    if (markdownHeading) { flush(); blocks.push({ kind: markdownHeading[1].length === 1 ? "title" : "heading", level: markdownHeading[1].length, text: cleanPdfText(markdownHeading[2]) }); continue; }
    if (rawLine.startsWith("- ") || rawLine.startsWith("* ") || rawLine.startsWith("+ ")) { flush(); blocks.push({ kind: "bullet", text: cleanPdfText(rawLine.slice(2)) }); continue; }
    if (/^[0-9]+[.)] +/.test(rawLine)) { flush(); blocks.push({ kind: "numbered", text: cleanPdfText(rawLine) }); continue; }
    if (rawLine.startsWith(">")) { flush(); blocks.push({ kind: "quote", text: cleanPdfText(rawLine.slice(1)) }); continue; }
    paragraph.push(rawLine);
  }
  flush();
  while (blocks.at(-1)?.kind === "spacer") blocks.pop();
  return blocks.length ? blocks : [{ kind: "body", text: "No report content was returned." }];
}

function pdfWords(text: string): PdfWord[] {
  return text.replaceAll("\t", " ").trim().split(" ").filter(Boolean).map((token) => token.startsWith("**") && token.endsWith("**") ? { text: token.slice(2, -2), bold: true } : token.startsWith("__") && token.endsWith("__") ? { text: token.slice(2, -2), bold: true } : token.startsWith("`") && token.endsWith("`") ? { text: token.slice(1, -1), code: true } : { text: token });
}

export async function textToPdf(content: string) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const code = await document.embedFont(StandardFonts.Courier);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 58;
  const usableWidth = pageWidth - margin * 2;
  const blocks = markdownBlocks(content);
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const newPage = () => { page = document.addPage([pageWidth, pageHeight]); y = pageHeight - margin; };
  const ensureSpace = (height: number) => { if (y - height < margin) newPage(); };
  const drawWords = (words: PdfWord[], x: number, baseline: number, size: number, color: ReturnType<typeof rgb>, defaultFont: typeof regular) => {
    let cursor = x;
    words.forEach((word, index) => { const font = word.code ? code : word.bold ? bold : defaultFont; page.drawText(word.text, { x: cursor, y: baseline, size, font, color }); cursor += font.widthOfTextAtSize(word.text, size); if (index < words.length - 1) cursor += font.widthOfTextAtSize(" ", size); });
  };
  for (const block of blocks) {
    if (block.kind === "spacer") { y -= 8; continue; }
    const title = block.kind === "title";
    const heading = block.kind === "heading";
    const size = title ? 24 : heading ? Math.max(13, 20 - ((block.level || 2) - 2) * 2) : 10.5;
    const lineHeight = title ? 29 : heading ? size + 7 : 15;
    const blockGap = title || heading ? 8 : 5;
    const prefix = block.kind === "bullet" ? "• " : "";
    const words = pdfWords(`${prefix}${block.text}`);
    let line: PdfWord[] = [];
    let lineWidth = 0;
    const flushLine = () => { if (!line.length) return; ensureSpace(lineHeight); const x = block.kind === "bullet" || block.kind === "numbered" ? margin + 10 : margin; const color = block.kind === "quote" ? rgb(0.32, 0.29, 0.4) : rgb(0.16, 0.15, 0.19); drawWords(line, x, y, size, color, title || heading ? bold : block.kind === "quote" ? italic : regular); y -= lineHeight; line = []; lineWidth = 0; };
    words.forEach((word) => { const font = word.code ? code : word.bold || title || heading ? bold : regular; const wordWidth = font.widthOfTextAtSize(word.text, size); const space = line.length ? regular.widthOfTextAtSize(" ", size) : 0; const indent = block.kind === "bullet" || block.kind === "numbered" ? 10 : 0; if (line.length && lineWidth + space + wordWidth > usableWidth - indent) flushLine(); line.push(word); lineWidth += (line.length > 1 ? space : 0) + wordWidth; });
    flushLine();
    y -= blockGap;
  }
  return Buffer.from(await document.save()).toString("base64");
}

function markdownParagraphs(content: string) {
  return content.split(String.fromCharCode(10)).map((line) => {
    const heading = line.match(/^(#+) +(.*)$/);
    if (heading) return new Paragraph({ text: heading[2], heading: ([HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][heading[1].length - 1] || HeadingLevel.HEADING_3) });
    const bullet = line.match(/^[-*+] +(.*)$/);
    if (bullet) return new Paragraph({ children: [new TextRun(bullet[1])], bullet: { level: 0 } });
    const numbered = line.match(/^[0-9]+[.)] +(.*)$/);
    if (numbered) return new Paragraph({ children: [new TextRun(numbered[1])], numbering: { reference: "elias-numbered-list", level: 0 } });
    return new Paragraph({ children: [new TextRun({ text: line || " ", break: line ? undefined : 1 })] });
  });
}

export async function textToDocx(content: string) {
  const document = new Document({ numbering: { config: [{ reference: "elias-numbered-list", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }] }] }, sections: [{ children: markdownParagraphs(content) }] });
  return Buffer.from(await Packer.toBuffer(document)).toString("base64");
}

export async function textToPptx(content: string) {
  const presentation = new pptxgen();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "ELIAS";
  presentation.subject = "Generated deliverable";
  presentation.title = "ELIAS deliverable";
  const lines = content.split(String.fromCharCode(10));
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const line of lines) { if (chunk.length >= 9) { chunks.push(chunk); chunk = []; } chunk.push(line); }
  if (chunk.length || !chunks.length) chunks.push(chunk);
  chunks.forEach((slideLines, index) => {
    const slide = presentation.addSlide();
    slide.background = { color: "101117" };
    slide.addText(slideLines[0] || `ELIAS deliverable · ${index + 1}`, { x: 0.65, y: 0.45, w: 12, h: 0.55, fontFace: "Aptos Display", fontSize: 24, bold: true, color: "F1EEF5", margin: 0 });
    const body = slideLines.slice(1).map((line) => line || " ").join(String.fromCharCode(10));
    if (body) slide.addText(body, { x: 0.75, y: 1.25, w: 11.8, h: 5.45, fontFace: "Aptos", fontSize: 16, color: "D6D0DF", breakLine: false, fit: "shrink", margin: 0.04, valign: "top", paraSpaceAfter: 8, bullet: { type: "bullet" } });
    slide.addText(`${index + 1} / ${chunks.length}`, { x: 11.65, y: 7.05, w: 1, h: 0.2, fontFace: "Aptos", fontSize: 8, color: "827A92", align: "right", margin: 0 });
  });
  return Buffer.from(await presentation.write({ outputType: "nodebuffer" }) as ArrayBuffer).toString("base64");
}

const prettierParsers: Record<string, string> = { js: "babel", jsx: "babel", ts: "typescript", tsx: "typescript", css: "css", html: "html", md: "markdown" };

export async function formatTextArtifact(name: string, content: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (extension === "md") unified().use(remarkParse).parse(content);
  const parser = prettierParsers[extension];
  if (!parser) return content;
  try { return await format(content, { parser, singleQuote: true, semi: true }); } catch { return content; }
}

export function artifactMime(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", ts: "text/typescript; charset=utf-8", tsx: "text/tsx; charset=utf-8", js: "text/javascript; charset=utf-8", jsx: "text/jsx; charset=utf-8", md: "text/markdown; charset=utf-8" } as Record<string, string>)[extension || ""] || "text/plain; charset=utf-8";
}

export function artifactLanguage(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "file";
  return ({ js: "JavaScript", jsx: "React JSX", ts: "TypeScript", tsx: "React TSX", html: "HTML", css: "CSS", md: "Markdown", txt: "Text", pdf: "PDF", docx: "Word document", pptx: "PowerPoint" } as Record<string, string>)[extension] || extension.toUpperCase();
}
