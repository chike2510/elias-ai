/** Study aids from a Library file: prompts and tolerant parsers for the model's JSON. Pure, shared by server and tests. */

export type StudyKind = "summary" | "quiz" | "flashcards";
export type QuizItem = { q: string; options: string[]; answer: number; why?: string };
export type Flashcard = { front: string; back: string };

const MAX_SOURCE = 24_000;

export function studyMessages(kind: StudyKind, name: string, text: string) {
  const source = text.length > MAX_SOURCE ? `${text.slice(0, MAX_SOURCE)}\n[... document continues; work from the part above]` : text;
  const task = kind === "summary"
    ? "Write a revision summary in markdown: one-line overview, then 5-10 bullet points of the key ideas, then 'Key terms' with short definitions. Use only the document."
    : kind === "quiz"
      ? 'Write 6 multiple-choice questions that test understanding of the document. Reply with JSON only: {"quiz":[{"q":"question","options":["A","B","C","D"],"answer":0,"why":"one-line explanation"}]}. answer is the 0-based index of the correct option.'
      : 'Write 10 flashcards covering the key facts and concepts. Reply with JSON only: {"flashcards":[{"front":"term or question","back":"short answer"}]}.';
  return [
    { role: "system" as const, content: "You are a careful study assistant. Base everything strictly on the provided document. Never invent facts that are not in it." },
    { role: "user" as const, content: `${task}\n\nDocument: ${name}\n---\n${source}\n---` },
  ];
}

function jsonBlock(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, reply, reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1), reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1)];
  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) continue;
    try { return JSON.parse(candidate.trim()); } catch { /* try the next */ }
  }
  return null;
}

const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

export function parseQuiz(reply: string): QuizItem[] {
  const data = jsonBlock(reply) as { quiz?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray((data as { quiz?: unknown })?.quiz) ? (data as { quiz: unknown[] }).quiz : [];
  const items: QuizItem[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    const q = str(raw?.q ?? raw?.question);
    const options = (Array.isArray(raw?.options) ? raw.options : Array.isArray(raw?.choices) ? raw.choices : []).map(str).filter(Boolean).slice(0, 6);
    let answer = Number(raw?.answer ?? raw?.correct);
    if (!Number.isInteger(answer)) {
      const label = str(raw?.answer ?? raw?.correct);
      answer = /^[A-F]$/i.test(label) ? label.toUpperCase().charCodeAt(0) - 65 : options.findIndex((option) => option === label);
    }
    if (!q || options.length < 2 || answer < 0 || answer >= options.length) continue;
    const why = str(raw?.why ?? raw?.explanation);
    items.push({ q, options, answer, ...(why ? { why } : {}) });
  }
  return items.slice(0, 12);
}

export function parseFlashcards(reply: string): Flashcard[] {
  const data = jsonBlock(reply) as { flashcards?: unknown; cards?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray((data as { flashcards?: unknown })?.flashcards) ? (data as { flashcards: unknown[] }).flashcards : Array.isArray((data as { cards?: unknown })?.cards) ? (data as { cards: unknown[] }).cards : [];
  const cards = (list as Array<Record<string, unknown>>).map((raw) => ({ front: str(raw?.front ?? raw?.term ?? raw?.q), back: str(raw?.back ?? raw?.definition ?? raw?.a) })).filter((card) => card.front && card.back);
  if (cards.length) return cards.slice(0, 30);
  // Fallback: "Front: ... / Back: ..." or "term - definition" lines.
  return reply.split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").match(/^(.{2,120}?)\s+(?:[-–—:]|=>)\s+(.{2,400})$/)).filter(Boolean).map((match) => ({ front: match![1].trim(), back: match![2].trim() })).slice(0, 30);
}
