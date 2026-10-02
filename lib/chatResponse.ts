export type StructuredChatResponse = {
  content: string;
  recommendation?: string;
  reasons?: string[];
  risks?: string[];
  suggestedReplies?: string[];
};

const SECTION_PATTERN = /\[\[ELIAS_(RECOMMENDATION|REASONS|RISKS|CHOICES)\]\]([\s\S]*?)\[\[\/ELIAS_\1\]\]/gi;
const SECTION_NAMES = "RECOMMENDATION|REASONS|RISKS|CHOICES";

function cleanPlainText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[\[\/?ELIAS_(?:RECOMMENDATION|REASONS|RISKS|CHOICES)\]\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanListBlock(value: string, limit: number, maxLength: number) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const candidate = cleanPlainText(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""), maxLength);
    const key = candidate.toLocaleLowerCase();
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    items.push(candidate);
    if (items.length === limit) break;
  }
  return items;
}

function cleanChoice(value: unknown) {
  if (typeof value !== "string") return null;
  const choice = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!choice || choice.length > 120 || !/[a-z0-9]/i.test(choice) || /\[\[\/?ELIAS_/i.test(choice)) return null;
  return choice;
}

/** Keep only up to three short, plain-text choices in a shape the UI can submit verbatim. */
export function safeSuggestedReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const choice = cleanChoice(item);
    if (!choice) continue;
    const key = choice.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(choice);
    if (items.length === 3) break;
  }
  return items;
}

/** Return only the selected, normalized server-proposed prompt; invalid indices never submit anything. */
export function selectSuggestedReply(value: unknown, index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return safeSuggestedReplies(value)[index] ?? null;
}

/** Strip private transport markers and validate optional UI metadata without altering ordinary replies. */
export function parseStructuredChatResponse(value: unknown): StructuredChatResponse {
  const raw = typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  const sections: Partial<Record<"RECOMMENDATION" | "REASONS" | "RISKS" | "CHOICES", string>> = {};
  let content = raw.replace(SECTION_PATTERN, (_match, name: string, body: string) => {
    const key = name.toUpperCase() as keyof typeof sections;
    if (sections[key] === undefined) sections[key] = body;
    return "\n";
  });

  // If generation stopped midway through a private metadata block, do not leak its body into the answer.
  const incomplete = new RegExp(`\\[\\[ELIAS_(?:${SECTION_NAMES})\\]\\]`, "i").exec(content);
  if (incomplete?.index !== undefined) content = content.slice(0, incomplete.index);
  content = content
    .replace(new RegExp(`\\[\\[\\/?ELIAS_(?:${SECTION_NAMES})\\]\\]`, "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const recommendation = sections.RECOMMENDATION === undefined ? "" : cleanPlainText(sections.RECOMMENDATION, 320);
  const reasons = sections.REASONS === undefined ? [] : cleanListBlock(sections.REASONS, 4, 180);
  const risks = sections.RISKS === undefined ? [] : cleanListBlock(sections.RISKS, 3, 180);
  const suggestedReplies = sections.CHOICES === undefined ? [] : safeSuggestedReplies(sections.CHOICES.split(/\r?\n/));

  return {
    content,
    ...(recommendation ? { recommendation } : {}),
    ...(reasons.length ? { reasons } : {}),
    ...(risks.length ? { risks } : {}),
    ...(suggestedReplies.length ? { suggestedReplies } : {}),
  };
}
