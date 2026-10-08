import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { hasDb } from "@/lib/assistant/db";
import { listFiles, saveFile } from "@/lib/assistant/files";
import { ASPECTS, generateImage, type Aspect } from "@/lib/assistant/studio";

export const runtime = "nodejs";
export const maxDuration = 150;

/** GET: the user's generated images (newest first), stored in the Library as kind "generated". */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!hasDb()) return jsonOk({ images: [] });
  try {
    const images = (await listFiles(auth.userId, { kind: "generated", limit: 60 })).filter((file) => file.mime.startsWith("image/") && file.hasData);
    return jsonOk({ images });
  } catch (error) { return jsonError(reportError(error, "assistant/studio", auth.userId)); }
}

/** POST { prompt, aspect?: square|portrait|landscape } -> generates an image and saves it to the gallery. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  if (!hasDb()) return jsonError("The gallery needs the database.", 503, "NOT_CONFIGURED");
  try {
    const body = await readJsonRequest<{ prompt?: string; aspect?: string }>(request);
    const prompt = String(body.prompt || "").replace(/\s+/g, " ").trim();
    if (prompt.length < 3) return jsonError("Describe the image you want.", 400, "BAD_REQUEST");
    if (prompt.length > 1000) return jsonError("Keep the description under 1,000 characters.", 400, "BAD_REQUEST");
    const aspect = (Object.keys(ASPECTS).includes(String(body.aspect)) ? body.aspect : "square") as Aspect;
    const image = await generateImage(prompt, aspect);
    const extension = image.mime === "image/jpeg" ? "jpg" : image.mime === "image/webp" ? "webp" : "png";
    const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
    const file = await saveFile(auth.userId, { name: `${slug}.${extension}`, mime: image.mime, size: image.data.length, kind: "generated", text: prompt, data: image.data });
    if (!file.hasData) return jsonError("That image came out too large to keep. Try again.", 413, "TOO_LARGE");
    return jsonOk({ image: file, provider: image.provider, model: image.model }, { status: 201 });
  } catch (error) { return jsonError(`Couldn't make that image: ${reportError(error, "assistant/studio:create", auth.userId)}`, 502, "GENERATION_FAILED"); }
}
