import { saveFile } from "@/lib/assistant/files";
import { ASPECTS, generateImage, type Aspect } from "@/lib/assistant/studio";
import { artifactMime, textToDocx, textToPdf, textToPptx } from "@/lib/artifacts";
import type { ToolSchema } from "@/lib/assistant/llm";
import type { Card } from "@/lib/assistant/cards";

/** Make tools for chat: images, downloadable files (PDF/Word/slides/...), and live HTML previews of apps. */
type Ctx = { userId: string; conversationId: string; addCard?: (card: Card) => void };
type Args = Record<string, unknown>;
type MakeTool = { schema: ToolSchema["function"]; run: (args: Args, ctx: Ctx) => Promise<unknown> };

export const MAX_PREVIEW_HTML = 150_000;
const FORMATS = ["pdf", "docx", "pptx", "md", "txt", "csv", "html", "json"] as const;
type Format = (typeof FORMATS)[number];

const str = (value: unknown) => typeof value === "string" ? value : "";
const slug = (value: string, fallback: string) => value.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || fallback;
const fileUrl = (id: string, inline = false) => `/api/assistant/files/${id}/download${inline ? "?inline=1" : ""}`;

export function formatFor(name: string, format: string): Format {
  const wanted = format.toLowerCase().replace(/^\./, "");
  if ((FORMATS as readonly string[]).includes(wanted)) return wanted as Format;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return (FORMATS as readonly string[]).includes(ext) ? ext as Format : "pdf";
}

/** Pulls a self-contained HTML document out of what the model sent (tolerates a ```html fence). */
export function cleanHtml(raw: string) {
  const fenced = raw.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  const html = (fenced ? fenced[1] : raw).trim();
  if (!html) return "";
  return /<html[\s>]|<!doctype/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
}

export const MAKE_TOOLS: Record<string, MakeTool> = {
  generate_image: {
    schema: {
      name: "generate_image",
      description: "Create an image (photo, portrait, illustration, logo, poster) from a text description. The image shows in the chat and is saved to the user's Studio gallery. Write a rich visual prompt: subject, style, lighting, setting.",
      parameters: { type: "object", properties: { prompt: { type: "string", description: "Detailed visual description" }, aspect: { type: "string", enum: Object.keys(ASPECTS), description: "square (default), portrait or landscape" } }, required: ["prompt"] },
    },
    run: async (args, ctx) => {
      const prompt = str(args.prompt).replace(/\s+/g, " ").trim().slice(0, 1000);
      if (prompt.length < 3) throw new Error("Describe the image first.");
      const aspect = (Object.keys(ASPECTS).includes(str(args.aspect)) ? str(args.aspect) : "square") as Aspect;
      const image = await generateImage(prompt, aspect);
      const ext = image.mime === "image/jpeg" ? "jpg" : image.mime === "image/webp" ? "webp" : "png";
      const file = await saveFile(ctx.userId, { name: `${slug(prompt, "image")}.${ext}`, mime: image.mime, size: image.data.length, kind: "generated", text: prompt, data: image.data, conversationId: ctx.conversationId });
      if (!file.hasData) throw new Error("That image came out too large to keep.");
      ctx.addCard?.({ kind: "image", fileId: file.id, name: file.name, prompt, url: fileUrl(file.id, true), downloadUrl: fileUrl(file.id) });
      return { ok: true, shown_in_chat: true, file: file.name, provider: image.provider };
    },
  },
  create_file: {
    schema: {
      name: "create_file",
      description: "Make a downloadable file the user asked for: pdf, docx (Word), pptx (slides), md, txt, csv, html or json. Write the COMPLETE content yourself in markdown (for pdf/docx: '# Title', '## Section', paragraphs, '- ' bullets; for pptx: one '## ' heading per slide). Never ask the user to supply the text.",
      parameters: { type: "object", properties: { name: { type: "string", description: "File name, e.g. 'future-of-superintelligence.pdf'" }, format: { type: "string", enum: [...FORMATS] }, content: { type: "string", description: "The full content" } }, required: ["name", "content"] },
    },
    run: async (args, ctx) => {
      const content = str(args.content).trim();
      if (content.length < 20) throw new Error("Write the full content first, then call create_file.");
      const format = formatFor(str(args.name), str(args.format));
      const name = `${slug(str(args.name), "document")}.${format}`;
      const data = format === "pdf" ? Buffer.from(await textToPdf(content)) : format === "docx" ? Buffer.from(await textToDocx(content)) : format === "pptx" ? Buffer.from(await textToPptx(content)) : Buffer.from(format === "html" ? cleanHtml(content) : content, "utf8");
      const mime = artifactMime(name).split(";")[0];
      const file = await saveFile(ctx.userId, { name, mime, size: data.length, kind: "generated", text: content, data, conversationId: ctx.conversationId });
      if (!file.hasData) throw new Error("That file came out too large to keep.");
      ctx.addCard?.({ kind: "file", fileId: file.id, name, mime, size: data.length, url: fileUrl(file.id) });
      return { ok: true, shown_in_chat: true, file: name, bytes: data.length };
    },
  },
  show_preview: {
    schema: {
      name: "show_preview",
      description: "Run an app, game, tool, web page or UI live in the chat. Pass ONE self-contained HTML document with inline <style> and <script> (no build step, no imports; a CDN <script src> is fine). Mobile-first and touch-friendly. Use for 'build me a calculator/app/game/page' and whenever the user asks for a preview or demo, even if earlier code was in another language: port it to HTML.",
      parameters: { type: "object", properties: { title: { type: "string", description: "Short name, e.g. 'Calculator'" }, html: { type: "string", description: "Complete HTML document" } }, required: ["title", "html"] },
    },
    run: async (args, ctx) => {
      const html = cleanHtml(str(args.html));
      if (html.length < 40) throw new Error("Send the full HTML document.");
      if (html.length > MAX_PREVIEW_HTML) throw new Error(`Keep the preview under ${MAX_PREVIEW_HTML / 1000}k characters.`);
      const title = str(args.title).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) || "Preview";
      ctx.addCard?.({ kind: "preview", title, html });
      return { ok: true, shown_in_chat: true, note: "The live preview card is showing. Reply in one line; don't paste the code." };
    },
  },
};

export const MAKE_RULES = `- MAKING THINGS: you can make images, files and live apps. Do it; never say you can't, and never ask the user to supply text you can write.
  - Image, photo, picture, portrait, logo, poster: call generate_image with a vivid prompt. Tasteful images of people (a beautiful woman, a portrait, a model) are fine. Only refuse sexual content, minors in any suggestive context, or realistic fakes of real people.
  - PDF, Word doc, slides, report, CV, essay as a file: research first if it must be current (web_search), then write the whole thing and call create_file with the right format. The file card is the deliverable: reply in one line.
  - App, calculator, game, tool, website, UI, or "show me a preview/demo": write one self-contained HTML file and call show_preview. Code alone is not a preview. If the earlier code was Python or terminal-only, port it to HTML.`;
