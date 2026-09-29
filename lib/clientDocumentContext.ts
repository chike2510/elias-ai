import type { ArtifactRecord } from "@/lib/persistence";

type ArtifactChunk = NonNullable<ArtifactRecord["chunks"]>[number];

export async function buildSelectedDocumentContext(
  artifacts: ArtifactRecord[],
  selectedIds: string[],
  query: string,
  maxCharacters = 18_000,
) {
  const selected = artifacts.filter((artifact) => selectedIds.includes(artifact.id));
  const stopWords = new Set(["this", "that", "with", "from", "what", "which", "about", "into", "have", "does", "your", "please", "document"]);
  const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stopWords.has(term)))];
  const ranked = selected.filter((artifact) => artifact.chunks?.length).flatMap((artifact) => (artifact.chunks || []).map((chunk) => {
    const source = chunk.text.toLowerCase();
    const summary = (chunk.summary || "").toLowerCase();
    const score = terms.reduce((total, term) => total + (summary.includes(term) ? 4 : source.includes(term) ? 2 : 0), 0)
      + (query && source.includes(query.toLowerCase()) ? 8 : 0)
      + (chunk.summary ? 1 : 0);
    return { artifact, chunk: chunk as ArtifactChunk, score };
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index).slice(0, 6);

  const sections: string[] = [];
  let budget = maxCharacters;
  for (const { artifact, chunk } of ranked) {
    const excerpt = (chunk.summary || chunk.text).slice(0, Math.min(4_500, budget));
    if (!excerpt) continue;
    sections.push(`[${artifact.name} · pages ${chunk.pageStart}-${chunk.pageEnd}]\n${excerpt}`);
    budget -= excerpt.length;
    if (budget <= 0) break;
  }

  for (const artifact of selected.filter((item) => !item.chunks?.length)) {
    if (budget <= 0) break;
    let content = artifact.text;
    if (!content && artifact.blob && artifact.type.startsWith("text/")) content = await artifact.blob.text();
    content ||= artifact.summary;
    if (!content) continue;
    const excerpt = content.slice(0, Math.min(4_500, budget));
    sections.push(`[Library file: ${artifact.name}]\n${excerpt}`);
    budget -= excerpt.length;
  }

  return {
    context: sections.join("\n\n"),
    noMatches: selectedIds.length > 0 && sections.length === 0,
  };
}
