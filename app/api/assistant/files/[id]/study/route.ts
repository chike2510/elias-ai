import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { getFile, saveStudy } from "@/lib/assistant/files";
import { complete } from "@/lib/assistant/llm";
import { parseFlashcards, parseQuiz, studyMessages, type StudyKind } from "@/lib/study";

export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ id: string }> };

/** POST { kind: summary|quiz|flashcards, refresh? } -> the study aid, cached on the file. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ kind?: string; refresh?: boolean }>(request);
    const kind = (["summary", "quiz", "flashcards"].includes(String(body.kind)) ? body.kind : "summary") as StudyKind;
    const file = await getFile(auth.userId, id);
    if (!file) return jsonError("File not found.", 404, "NOT_FOUND");
    const cached = file.study[kind];
    if (cached && (!Array.isArray(cached) || cached.length) && !body.refresh) return jsonOk({ kind, value: cached, cached: true });
    if ((file.text || "").trim().length < 40) return jsonError("There isn't enough readable text in this file to study from.", 422, "NO_TEXT");
    const result = await complete(studyMessages(kind, file.name, file.text || ""), [], { temperature: 0.3, route: { tier: kind === "summary" ? "fast" : "strong" } });
    const value = kind === "summary" ? result.content.trim() : kind === "quiz" ? parseQuiz(result.content) : parseFlashcards(result.content);
    if (Array.isArray(value) ? !value.length : !value) return jsonError("That didn't come out right. Try again.", 502, "STUDY_FAILED");
    await saveStudy(auth.userId, id, { [kind]: value });
    return jsonOk({ kind, value, cached: false });
  } catch (error) { return jsonError(reportError(error, "assistant/files/study", auth.userId), 500, "STUDY_FAILED"); }
}
