/**
 * Patch-style editing for the coding agent: exact find/replace edits, unified-diff hunks with
 * fuzzy context matching, and a unified-diff generator for the diff card.
 * Pure: no imports, so tests load it with a plain TypeScript transpile.
 */

export type Edit = { find: string; replace: string; all?: boolean };
export type Conflict = { index: number; reason: string; expected: string; nearLine?: number };
export type ApplyResult =
  | { ok: true; content: string; applied: number; notes: string[] }
  | { ok: false; error: string; conflicts: Conflict[] };

export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };
export type FilePatch = { oldPath: string | null; newPath: string | null; hunks: Hunk[] };

/* ---------------- helpers ---------------- */

function eolOf(text: string) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized === "") return { lines: [] as string[], trailing: true };
  const trailing = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (trailing) lines.pop();
  return { lines, trailing: trailing || normalized === "" };
}

function joinLines(lines: string[], trailing: boolean, eol: string) {
  return lines.join(eol) + (trailing && lines.length ? eol : "");
}

/** Whitespace-insensitive key for one line: trims the ends and collapses inner runs. */
const loose = (line: string) => line.trim().replace(/\s+/g, " ");

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) { count += 1; at = haystack.indexOf(needle, at + needle.length); }
  return count;
}

function lineOfOffset(text: string, offset: number) {
  return text.slice(0, offset).split("\n").length;
}

/** Finds `needle` (lines) in `hay` comparing with `eq`; returns all start indexes. */
function findBlock(hay: string[], needle: string[], eq: (a: string, b: string) => boolean, from = 0) {
  const hits: number[] = [];
  if (!needle.length) return hits;
  outer: for (let start = from; start + needle.length <= hay.length; start += 1) {
    for (let k = 0; k < needle.length; k += 1) if (!eq(hay[start + k], needle[k])) continue outer;
    hits.push(start);
  }
  return hits;
}

/* ---------------- find / replace ---------------- */

/**
 * Applies exact find/replace edits in order. A `find` must match exactly once (or set all=true).
 * When it doesn't match exactly, a whitespace-insensitive line match is tried, and the replacement
 * is re-indented to the matched block. Nothing is applied unless every edit succeeds.
 */
export function applyEdits(content: string, edits: Edit[]): ApplyResult {
  let text = content;
  const notes: string[] = [];
  const conflicts: Conflict[] = [];
  edits.forEach((edit, index) => {
    if (conflicts.length) return;
    const find = edit.find ?? "";
    if (!find) { conflicts.push({ index, reason: "empty find text", expected: "" }); return; }
    const exact = countOccurrences(text, find);
    if (exact === 1 || (exact > 1 && edit.all)) {
      text = edit.all ? text.split(find).join(edit.replace) : text.replace(find, () => edit.replace);
      return;
    }
    if (exact > 1) {
      const lines: number[] = [];
      let at = text.indexOf(find);
      while (at >= 0 && lines.length < 5) { lines.push(lineOfOffset(text, at)); at = text.indexOf(find, at + find.length); }
      conflicts.push({ index, reason: `find text matches ${exact} places (lines ${lines.join(", ")}); add surrounding lines to make it unique, or set all=true`, expected: find.slice(0, 400), nearLine: lines[0] });
      return;
    }
    // Fuzzy: compare line by line ignoring whitespace differences.
    const eol = eolOf(text);
    const file = splitLines(text);
    const want = splitLines(find).lines.filter((line, i, all) => !(i === 0 && !line.trim() && all.length > 1));
    while (want.length > 1 && !want[want.length - 1].trim()) want.pop();
    const hits = findBlock(file.lines, want, (a, b) => loose(a) === loose(b));
    if (hits.length === 1 || (hits.length > 1 && edit.all)) {
      const targets = edit.all ? hits : hits.slice(0, 1);
      // Apply bottom-up so indexes stay valid.
      for (const start of [...targets].reverse()) {
        const indent = (file.lines[start].match(/^\s*/) || [""])[0];
        const findIndent = (want[0].match(/^\s*/) || [""])[0];
        const replacement = splitLines(edit.replace).lines.map((line) => line.startsWith(findIndent) ? indent + line.slice(findIndent.length) : line);
        file.lines.splice(start, want.length, ...replacement);
      }
      text = joinLines(file.lines, file.trailing, eol);
      notes.push(`edit ${index + 1}: matched ignoring whitespace at line ${hits[0] + 1}`);
      return;
    }
    if (hits.length > 1) { conflicts.push({ index, reason: `find text matches ${hits.length} places ignoring whitespace; make it unique`, expected: find.slice(0, 400), nearLine: hits[0] + 1 }); return; }
    const first = loose(want[0] || "");
    const near = first ? file.lines.findIndex((line) => { const key = loose(line); return key.includes(first) || (key.length >= 3 && first.includes(key)); }) : -1;
    conflicts.push({ index, reason: "find text not found; read the file again and copy the exact lines", expected: find.slice(0, 400), nearLine: near >= 0 ? near + 1 : undefined });
  });
  if (conflicts.length) return { ok: false, error: `Edit ${conflicts[0].index + 1} failed: ${conflicts[0].reason}`, conflicts };
  return { ok: true, content: text, applied: edits.length, notes };
}

/* ---------------- unified diff: parse ---------------- */

function cleanPath(raw: string) {
  const path = raw.trim().split("\t")[0].replace(/^"|"$/g, "");
  if (path === "/dev/null") return null;
  return path.replace(/^[ab]\//, "");
}

/** Parses a unified diff (git style or plain) into per-file hunks. Hunk headers without counts are accepted. */
export function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const files: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: Hunk | null = null;
  const startFile = (oldPath: string | null, newPath: string | null) => { current = { oldPath, newPath, hunks: [] }; files.push(current); hunk = null; };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      startFile(match ? match[1] : null, match ? match[2] : null);
      continue;
    }
    if (line.startsWith("--- ") && (lines[i + 1] || "").startsWith("+++ ")) {
      const oldPath = cleanPath(line.slice(4));
      const newPath = cleanPath(lines[i + 1].slice(4));
      const cur = current as FilePatch | null;
      if (!cur || cur.hunks.length) startFile(oldPath, newPath);
      else { cur.oldPath = oldPath; cur.newPath = newPath; }
      i += 1;
      continue;
    }
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/) || (line.startsWith("@@") ? ["@@", "0", undefined, "0", undefined] as const : null);
    if (header) {
      if (!current) startFile(null, null);
      hunk = { oldStart: Number(header[1]), oldLines: header[2] === undefined ? -1 : Number(header[2]), newStart: Number(header[3]), newLines: header[4] === undefined ? -1 : Number(header[4]), lines: [] };
      (current as unknown as FilePatch).hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) (hunk as Hunk).lines.push(line);
    else if (line === "") (hunk as Hunk).lines.push(" "); // blank context lines often lose their leading space
    else if (/^(index |new file mode|deleted file mode|similarity|rename |old mode|new mode)/.test(line)) continue;
  }
  // Drop trailing blank context that came from the diff's final newline.
  for (const file of files) for (const item of file.hunks) while (item.lines.length && item.lines[item.lines.length - 1] === " " && item.oldLines >= 0 && item.lines.filter((l) => !l.startsWith("+")).length > item.oldLines) item.lines.pop();
  return files.filter((file) => file.hunks.length || file.oldPath !== file.newPath);
}

/* ---------------- unified diff: apply ---------------- */

/**
 * Applies hunks to content. Each hunk's old block is located near its stated line (then anywhere
 * after the previous hunk), first exactly, then ignoring whitespace, then with up to `fuzz` context
 * lines dropped from each end. All-or-nothing: any hunk that can't be placed is a conflict.
 */
export function applyHunks(content: string, hunks: Hunk[], options: { fuzz?: number } = {}): ApplyResult {
  const fuzz = options.fuzz ?? 2;
  const eol = eolOf(content);
  const file = splitLines(content);
  let lines = file.lines;
  const notes: string[] = [];
  const conflicts: Conflict[] = [];
  let offset = 0;
  let floor = 0;
  hunks.forEach((hunk, index) => {
    if (conflicts.length) return;
    const body = hunk.lines.map((line) => ({ kind: line[0], text: line.slice(1) }));
    const expectedAt = Math.max(0, (hunk.oldStart || 1) - 1 + offset);
    let placed: { start: number; drop: [number, number]; how: string } | null = null;
    for (let cut = 0; cut <= fuzz && !placed; cut += 1) {
      for (let head = 0; head <= cut && !placed; head += 1) {
        const tail = cut - head;
        // Only context lines may be dropped.
        if (body.slice(0, head).some((item) => item.kind !== " ") || body.slice(body.length - tail).some((item) => item.kind !== " ")) continue;
        const kept = body.slice(head, body.length - tail);
        const old = kept.filter((item) => item.kind !== "+").map((item) => item.text);
        if (!old.length) {
          // Pure insertion (e.g. new file or append): insert at the expected line.
          if (cut === 0) placed = { start: Math.min(expectedAt + (hunk.oldLines === 0 && hunk.oldStart > 0 ? 1 : 0), lines.length), drop: [0, 0], how: "insert" };
          continue;
        }
        for (const [how, eq] of [["exact", (a: string, b: string) => a === b], ["whitespace", (a: string, b: string) => loose(a) === loose(b)]] as const) {
          const hits = findBlock(lines, old, eq, 0);
          if (!hits.length) continue;
          const after = hits.filter((hit) => hit >= floor);
          const pool = after.length ? after : hits;
          const best = pool.reduce((a, b) => Math.abs(b - expectedAt) < Math.abs(a - expectedAt) ? b : a);
          placed = { start: best, drop: [head, tail], how: cut ? `${how}, fuzz ${cut}` : how };
          break;
        }
      }
    }
    if (!placed) {
      const firstOld = body.find((item) => item.kind !== "+")?.text || "";
      const near = firstOld.trim() ? lines.findIndex((line) => loose(line) === loose(firstOld)) : -1;
      conflicts.push({ index, reason: "context doesn't match the file; re-read the file and regenerate this hunk", expected: body.filter((item) => item.kind !== "+").map((item) => item.text).join("\n").slice(0, 600), nearLine: near >= 0 ? near + 1 : undefined });
      return;
    }
    const kept = body.slice(placed.drop[0], body.length - placed.drop[1]);
    const oldCount = kept.filter((item) => item.kind !== "+").length;
    // Keep the file's own text for context lines (matters when matched ignoring whitespace).
    const original = lines.slice(placed.start, placed.start + oldCount);
    let cursor = 0;
    const replacement: string[] = [];
    for (const item of kept) {
      if (item.kind === " ") { replacement.push(original[cursor] ?? item.text); cursor += 1; }
      else if (item.kind === "-") cursor += 1;
      else if (item.kind === "+") replacement.push(item.text);
    }
    lines = [...lines.slice(0, placed.start), ...replacement, ...lines.slice(placed.start + oldCount)];
    if (placed.how !== "exact" && placed.how !== "insert") notes.push(`hunk ${index + 1}: applied (${placed.how}) at line ${placed.start + 1}`);
    else if (Math.abs(placed.start - expectedAt) > 0 && hunk.oldStart > 0 && placed.how === "exact") notes.push(`hunk ${index + 1}: applied at line ${placed.start + 1} (offset ${placed.start - expectedAt})`);
    offset += replacement.length - oldCount;
    floor = placed.start + replacement.length;
  });
  if (conflicts.length) return { ok: false, error: `Hunk ${conflicts[0].index + 1} of ${hunks.length} failed: ${conflicts[0].reason}`, conflicts };
  const trailing = file.trailing || content === "";
  return { ok: true, content: joinLines(lines, trailing, eol), applied: hunks.length, notes };
}

/* ---------------- unified diff: generate ---------------- */

type Op = { kind: " " | "-" | "+"; text: string };

/** Myers diff over lines. Falls back to a plain replace when the edit distance is huge. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const limit = Math.min(max, 4000);
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  let found = false;
  for (let d = 0; d <= limit; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v.set(k, x);
      if (x >= n && y >= m) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) return [...a.map((text) => ({ kind: "-" as const, text })), ...b.map((text) => ({ kind: "+" as const, text }))];
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ kind: " ", text: a[x - 1] }); x -= 1; y -= 1; }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: "+", text: b[y - 1] });
      else ops.push({ kind: "-", text: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** A git-style unified diff between two versions of one file. null old/new means created/deleted. */
export function unifiedDiff(path: string, before: string | null, after: string | null, context = 3): string {
  const a = before === null ? [] : splitLines(before).lines;
  const b = after === null ? [] : splitLines(after).lines;
  const ops = diffLines(a, b);
  if (!ops.some((op) => op.kind !== " ")) return "";
  const header = [`diff --git a/${path} b/${path}`, before === null ? "new file mode 100644" : after === null ? "deleted file mode 100644" : "", `--- ${before === null ? "/dev/null" : `a/${path}`}`, `+++ ${after === null ? "/dev/null" : `b/${path}`}`].filter(Boolean);
  const out: string[] = [...header];
  // Group changes into hunks with `context` lines around them.
  let i = 0;
  let oldLine = 1;
  let newLine = 1;
  const positions = ops.map((op) => { const pos = { op, oldLine, newLine }; if (op.kind !== "+") oldLine += 1; if (op.kind !== "-") newLine += 1; return pos; });
  while (i < positions.length) {
    while (i < positions.length && positions[i].op.kind === " ") i += 1;
    if (i >= positions.length) break;
    let start = Math.max(0, i - context);
    let end = i;
    for (;;) {
      while (end < positions.length && positions[end].op.kind !== " ") end += 1;
      let gap = end;
      while (gap < positions.length && positions[gap].op.kind === " ") gap += 1;
      if (gap < positions.length && gap - end <= context * 2) { end = gap; continue; }
      end = Math.min(positions.length, end + context);
      break;
    }
    const slice = positions.slice(start, end);
    const oldCount = slice.filter((p) => p.op.kind !== "+").length;
    const newCount = slice.filter((p) => p.op.kind !== "-").length;
    const oldStart = oldCount ? slice.find((p) => p.op.kind !== "+")!.oldLine : Math.max(0, slice[0].oldLine - 1);
    const newStart = newCount ? slice.find((p) => p.op.kind !== "-")!.newLine : Math.max(0, slice[0].newLine - 1);
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const p of slice) out.push(`${p.op.kind}${p.op.text}`);
    i = end;
    start = end;
  }
  return out.join("\n") + "\n";
}

export function diffStats(diff: string) {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/** Content of a file created by a patch (all hunks are pure additions). */
export function contentFromNewFile(hunks: Hunk[]) {
  const lines = hunks.flatMap((hunk) => hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)));
  return lines.length ? lines.join("\n") + "\n" : "";
}
