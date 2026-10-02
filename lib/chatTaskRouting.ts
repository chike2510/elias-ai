import { hasCodeVocabulary, hasExplicitCodeIntent, hasResearchIntent } from "@/lib/taskIntent";

export type ChatTaskKind = "code" | "research" | "study" | "general";

export function inferChatTask(value: string): ChatTaskKind {
  if (hasExplicitCodeIntent(value)) return "code";
  if (hasResearchIntent(value)) return "research";
  if (hasCodeVocabulary(value)) return "code";
  if (/\b(study|exam|notes|flashcard|pdf|chapter|document)\b/i.test(value)) return "study";
  return "general";
}
