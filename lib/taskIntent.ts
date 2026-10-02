import { includesCodeArtifactFile } from "@/lib/taskArtifactRequirements";

// Treat code as decisive when an action is tied to a concrete code or repository target.
// This avoids misreading ordinary research language such as football "build-up" or "developments".
const explicitCodeActionWithTarget = /\b(?:build|implement|develop|debug|refactor|fix|write|edit|modify|change|update|create|review|inspect|test|run)\b(?:\s+[\w/-]+){0,7}\s+(?:code(?:base)?|bug|tsx|jsx|typescript|javascript|python|repository|repo|github|project|component|dashboard|website|web\s+app|application|app|api|function|script|module|package|service|software|system)\b/i;
const researchIntent = /\b(?:research|investigate|latest|current|today|yesterday|recent|live|news|source|citation|verify|compare|search\s+(?:the\s+)?web)\b/i;
const codeVocabulary = /\b(?:code|coding|bug|debug|tsx|jsx|typescript|javascript|python|repository|repo|github|refactor|implement|project|component|dashboard|website|web\s+app|file\s+tree|api|run\s+type\s+checks|review\s+the\s+existing.*architecture)\b/i;
const nonFootballBuild = /\bbuild\b(?![-\s]*up\b)/i;

export function hasExplicitCodeIntent(value: string) {
  return includesCodeArtifactFile(value) || explicitCodeActionWithTarget.test(value);
}

export function hasResearchIntent(value: string) {
  return researchIntent.test(value);
}

export function hasCodeVocabulary(value: string) {
  return codeVocabulary.test(value) || nonFootballBuild.test(value);
}
