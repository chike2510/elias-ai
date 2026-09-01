import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import pptxgen from "pptxgenjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { format } from "prettier";
import { unified } from "unified";
import remarkParse from "remark-parse";

function wrapText(value: string, maxWidth: number, measure: (text: string) => number) {
  if (!value) return [""];
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      if (measure(word) <= maxWidth) current = word;
      else {
        let fragment = "";
        for (const character of word) {
          if (fragment && measure(`${fragment}${character}`) > maxWidth) { lines.push(fragment); fragment = character; }
          else fragment += character;
        }
        current = fragment;
      }
    } else if (measure(`${current} ${word}`) <= maxWidth) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function textToPdf(content: string) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = 15;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const usableWidth = pageWidth - margin * 2;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const lines = content.split(/\r?\n/).flatMap((line) => wrapText(line, usableWidth, (text) => font.widthOfTextAtSize(text, fontSize)));
  for (const line of lines) {
    if (y < margin + lineHeight) { page = document.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.08, 0.08, 0.1), maxWidth: usableWidth });
    y -= lineHeight;
  }
  return Buffer.from(await document.save()).toString("base64");
}

function markdownParagraphs(content: string) {
  return content.split(/\r?\n/).map((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) return new Paragraph({ text: heading[2], heading: ([HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][heading[1].length - 1] || HeadingLevel.HEADING_3) });
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) return new Paragraph({ children: [new TextRun(bullet[1])], bullet: { level: 0 } });
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) return new Paragraph({ children: [new TextRun(numbered[1])], numbering: { reference: "elias-numbered-list", level: 0 } });
    return new Paragraph({ children: [new TextRun({ text: line || " ", break: line ? undefined : 1 })] });
  });
}

export async function textToDocx(content: string) {
  const document = new Document({
    numbering: { config: [{ reference: "elias-numbered-list", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }] }] },
    sections: [{ children: markdownParagraphs(content) }],
  });
  return Buffer.from(await Packer.toBuffer(document)).toString("base64");
}

export async function textToPptx(content: string) {
  const presentation = new pptxgen();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "ELIAS";
  presentation.subject = "Generated deliverable";
  presentation.title = "ELIAS deliverable";
  const lines = content.split(/\r?\n/);
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const line of lines) {
    if (chunk.length >= 9) { chunks.push(chunk); chunk = []; }
    chunk.push(line);
  }
  if (chunk.length || !chunks.length) chunks.push(chunk);
  chunks.forEach((slideLines, index) => {
    const slide = presentation.addSlide();
    slide.background = { color: "101117" };
    slide.addText(slideLines[0] || `ELIAS deliverable · ${index + 1}`, { x: 0.65, y: 0.45, w: 12, h: 0.55, fontFace: "Aptos Display", fontSize: 24, bold: true, color: "F1EEF5", margin: 0 });
    const body = slideLines.slice(1).map((line) => line || " ").join("\n");
    if (body) slide.addText(body, { x: 0.75, y: 1.25, w: 11.8, h: 5.45, fontFace: "Aptos", fontSize: 16, color: "D6D0DF", breakLine: false, fit: "shrink", margin: 0.04, valign: "top", paraSpaceAfter: 8, bullet: { type: "bullet" } });
    slide.addText(`${index + 1} / ${chunks.length}`, { x: 11.65, y: 7.05, w: 1, h: 0.2, fontFace: "Aptos", fontSize: 8, color: "827A92", align: "right", margin: 0 });
  });
  return Buffer.from(await presentation.write({ outputType: "nodebuffer" }) as ArrayBuffer).toString("base64");
}

const prettierParsers: Record<string, string> = { js: "babel", jsx: "babel", ts: "typescript", tsx: "typescript", css: "css", html: "html", md: "markdown" };

export async function formatTextArtifact(name: string, content: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (extension === "md") {
    unified().use(remarkParse).parse(content);
  }
  const parser = prettierParsers[extension];
  if (!parser) return content;
  try { return await format(content, { parser, singleQuote: true, semi: true }); }
  catch { return content; }
}

export function artifactMime(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", ts: "text/typescript; charset=utf-8", tsx: "text/tsx; charset=utf-8", js: "text/javascript; charset=utf-8", jsx: "text/jsx; charset=utf-8", md: "text/markdown; charset=utf-8" } as Record<string, string>)[extension || ""] || "text/plain; charset=utf-8";
}

export function artifactLanguage(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "file";
  return ({ js: "JavaScript", jsx: "React JSX", ts: "TypeScript", tsx: "React TSX", html: "HTML", css: "CSS", md: "Markdown", txt: "Text", pdf: "PDF", docx: "Word document", pptx: "PowerPoint" } as Record<string, string>)[extension] || extension.toUpperCase();
}
