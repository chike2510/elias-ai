import { includesCodeArtifactFile } from "@/lib/taskArtifactRequirements";

export type ChatTaskKind = "code" | "research" | "study" | "general";

export function inferChatTask(value: string): ChatTaskKind {
  const text = value.toLowerCase();
  if (includesCodeArtifactFile(value) || /\b(build|code|bug|debug|tsx|jsx|typescript|javascript|repository|github|refactor|implement)\b/.test(text)) return "code";
  if (/research|latest|current|today|news|source|search the web/.test(text)) return "research";
  if (/study|exam|notes|flashcard|pdf|chapter|document/.test(text)) return "study";
  return "general";
}
