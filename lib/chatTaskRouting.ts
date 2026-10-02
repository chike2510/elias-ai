import { hasCodeVocabulary, hasExplicitCodeIntent, hasResearchIntent } from "@/lib/taskIntent";

export type ChatTaskKind = "code" | "research" | "study" | "general";

export function inferChatTask(value: string): ChatTaskKind {
  if (hasExplicitCodeIntent(value)) return "code";
  if (hasResearchIntent(value)) return "research";
  if (hasCodeVocabulary(value)) return "code";
  if (/\b(study|exam|notes|flashcard|pdf|chapter|document)\b/i.test(value)) return "study";
  return "general";
}

export function shouldHandoffToTask(value: string, hasAttachments = false) {
  if (hasAttachments) return true;
  const text = value.trim();
  if (text.length < 12) return false;
  const explicitWork = /\b(create|generate|build|make|write|produce|download|develop|implement|refactor|debug|review|research|study|analy[sz]e|compare|summari[sz]e)\b/i.test(text);
  const liveResearch = /\b(latest|current|today|yesterday|recent|live)\b/i.test(text) && /\b(update|news|result|score|fixture|match|source|sources|citation|verify|research|report)\b/i.test(text);
  return (explicitWork || liveResearch) && /\b(report|pdf|document|file|artifact|website|web app|app|page|screen|dashboard|repository|repo|project|code|source|paper|slides|presentation|chapter|notes|exam|course|latest|current|sources|citations|interface|ui|ux|design|feature|bug|component|update|news|result|score|fixture|match|verify)\b/i.test(text);
}
