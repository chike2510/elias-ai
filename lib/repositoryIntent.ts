const REPOSITORY_MENTION = /\b(?:github|repositories?|repos?|codebases?|code\s+base)\b/gi;
const NEGATION = /\b(?:do\s+not|don['’]t|cannot|can['’]t|never|avoid|without|no)\b/gi;
const AFFIRMATIVE_RESET = /\b(?:but|instead|rather|however)\b/i;

function isNegatedMention(objective: string, index: number) {
  const prefix = objective.slice(0, index);
  let clauseStart = 0;
  for (const boundary of prefix.matchAll(/[.!?;]\s+|\n/g)) {
    clauseStart = boundary.index + boundary[0].length;
  }

  const beforeMention = prefix.slice(clauseStart);
  const negations = [...beforeMention.matchAll(NEGATION)];
  const lastNegation = negations.at(-1);
  if (!lastNegation) return false;

  const afterNegation = beforeMention.slice(lastNegation.index + lastNegation[0].length);
  return !AFFIRMATIVE_RESET.test(afterNegation);
}

/**
 * Whether the objective affirmatively refers to repository work. A repository
 * mentioned only in a prohibition (for example, "do not access any repository")
 * is not a request to hydrate or inspect GitHub.
 */
export function referencesRepository(objective: string) {
  for (const mention of objective.matchAll(REPOSITORY_MENTION)) {
    if (!isNegatedMention(objective, mention.index)) return true;
  }
  return false;
}
