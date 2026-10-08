/**
 * The diff card: what the coding agent changed, shown in chat after code_diff / code_commit /
 * code_verify / code_open_pr / code_merge_pr. Pure, so tests load it directly.
 */
export type DiffFile = { path: string; status: string; added: number; removed: number };
export type DiffCard = {
  kind: "diff";
  title: string;
  repo: string;
  branch?: string | null;
  base?: string;
  files: DiffFile[];
  added: number;
  removed: number;
  /** Unified diff text, capped for the stored message. */
  diff?: string;
  commit?: { sha: string; url: string };
  ci?: { status: string; attempt?: number; maxAttempts?: number; url?: string; previewUrl?: string; failure?: string };
  pr?: { number: number; url: string; merged?: boolean };
};

const DIFF_CAP = 12_000;
type Raw = Record<string, unknown>;
const asFiles = (value: unknown): DiffFile[] => Array.isArray(value) ? value.map((item: Raw) => ({ path: String(item.path), status: String(item.status || "modified"), added: Number(item.added) || 0, removed: Number(item.removed) || 0 })) : [];
const repoFromUrl = (url: string) => url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] || "";

export function codeCardFor(tool: string, output: unknown): DiffCard | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Raw;
  if (tool === "code_diff") {
    const files = asFiles(raw.files);
    if (!files.length) return null;
    const diff = String(raw.diff || "");
    return { kind: "diff", title: "Changes", repo: String(raw.repo || ""), branch: (raw.branch as string) || null, base: String(raw.base || ""), files, added: Number(raw.added) || 0, removed: Number(raw.removed) || 0, diff: diff.length > DIFF_CAP ? `${diff.slice(0, DIFF_CAP)}\n… (truncated)` : diff };
  }
  if (tool === "code_commit" && raw.ok) {
    return { kind: "diff", title: "Committed", repo: String(raw.repo || ""), branch: String(raw.branch || ""), files: asFiles(raw.files), added: Number(raw.added) || 0, removed: Number(raw.removed) || 0, commit: { sha: String(raw.sha), url: String(raw.url || "") } };
  }
  if (tool === "code_verify" && raw.status) {
    const failures = Array.isArray(raw.failures) ? raw.failures as string[] : [];
    return { kind: "diff", title: raw.status === "passed" ? "Checks passed" : raw.status === "failed" ? "Checks failed" : "Checks", repo: "", files: [], added: 0, removed: 0, commit: raw.sha ? { sha: String(raw.sha), url: "" } : undefined, ci: { status: String(raw.status), attempt: Number(raw.attempt) || 0, maxAttempts: Number(raw.maxAttempts) || undefined, url: (raw.runUrl as string) || undefined, previewUrl: (raw.previewUrl as string) || undefined, failure: failures[0]?.slice(0, 1500) } };
  }
  if ((tool === "code_open_pr" || tool === "code_merge_pr") && raw.ok) {
    const url = String(raw.url || "");
    return { kind: "diff", title: tool === "code_merge_pr" ? `Merged #${raw.number}` : `PR #${raw.number} opened`, repo: repoFromUrl(url), branch: (raw.branch as string) || null, base: String(raw.base || ""), files: [], added: 0, removed: 0, pr: { number: Number(raw.number), url, merged: tool === "code_merge_pr" } };
  }
  return null;
}

/** Splits a unified diff into per-file chunks for rendering. */
export function diffByFile(diff: string) {
  const out: Array<{ path: string; lines: string[] }> = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { out.push({ path: line.replace(/^diff --git a\/(.+?) b\/.+$/, "$1"), lines: [] }); continue; }
    if (!out.length || /^(index |new file mode|deleted file mode|--- |\+\+\+ )/.test(line)) continue;
    out[out.length - 1].lines.push(line);
  }
  return out;
}
