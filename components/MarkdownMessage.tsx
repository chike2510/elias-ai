"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { isNumericCell, splitSections, tableAlignments, visibleReply } from "@/lib/richReply";

function InlineText({ text, taskId }: { text: string; taskId?: string }) {
  const parts = text.split(/(\\?\[[^\]]+\\?\]\([^\)]+\)|\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|`[^`]+`|https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => {
    const markdownLink = part.match(/^\\?\[([^\]]+)\\?\]\(([^\)]+)\)$/);
    if (markdownLink) {
      const [, label, rawHref] = markdownLink;
      const href = rawHref.startsWith("/artifacts/") && taskId ? `/api/tasks/${encodeURIComponent(taskId)}/artifact/${rawHref.slice("/artifacts/".length)}` : rawHref;
      return <a key={index} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined} download={href.startsWith("/api/tasks/")}>{label}</a>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code className="markdown-inline-code" key={index}>{part.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\//, "")}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

function cells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  return cells(line).length > 0 && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isSpecialLine(line: string, next?: string) {
  return /^#{1,6}\s+/.test(line) || /^---+\s*$/.test(line) || /^>\s?/.test(line) || /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || (line.includes("|") && !!next && isTableSeparator(next));
}

function RichTextBlocks({ text, taskId }: { text: string; taskId?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const output: React.ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const line = lines[index];
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const Tag = ({ 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const)[level as 1 | 2 | 3 | 4 | 5 | 6];
      output.push(<Tag key={`heading-${key++}`}><InlineText text={heading[2]} taskId={taskId} /></Tag>);
      index += 1;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      output.push(<hr key={`rule-${key++}`} />);
      index += 1;
      continue;
    }
    if (line.trim().startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) { quote.push(lines[index].replace(/^\s*>\s?/, "")); index += 1; }
      output.push(<blockquote key={`quote-${key++}`}>{quote.map((item, quoteIndex) => <Fragment key={quoteIndex}>{quoteIndex ? <br /> : null}<InlineText text={item} taskId={taskId} /></Fragment>)}</blockquote>);
      continue;
    }
    if ((line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]))) {
      const header = cells(line);
      const align = tableAlignments(cells(lines[index + 1]));
      index += 2;
      const body: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) { body.push(cells(lines[index])); index += 1; }
      output.push(<TableBlock key={`table-${key++}`} header={header} body={body} align={align} taskId={taskId} />);
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? /^\d+[.)]\s+/.test(lines[index]) : /^[-*]\s+/.test(lines[index]))) {
        items.push(lines[index].replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      output.push(<List key={`list-${key++}`}>{items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} taskId={taskId} /></li>)}</List>);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index], lines[index + 1])) { paragraph.push(lines[index]); index += 1; }
    output.push(<p key={`paragraph-${key++}`}>{paragraph.map((item, paragraphIndex) => <Fragment key={paragraphIndex}>{paragraphIndex ? <br /> : null}<InlineText text={item} taskId={taskId} /></Fragment>)}</p>);
  }
  return <>{output}</>;
}

/** Wide tables scroll sideways inside the bubble with the first column pinned; an edge fade shows there is more. */
function TableBlock({ header, body, align, taskId }: { header: string[]; body: string[][]; align: Array<"left" | "center" | "right" | undefined>; taskId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const overflow = el.scrollWidth - el.clientWidth > 2;
      const next = { overflow, start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 };
      setScroll((current) => current.overflow === next.overflow && current.start === next.start && current.end === next.end ? current : next);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => { el.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, []);
  const numeric = header.map((_, column) => body.length > 0 && body.every((row) => !row[column] || isNumericCell(row[column])) && body.some((row) => row[column]));
  const cellAlign = (column: number) => align[column] || (numeric[column] && column > 0 ? "right" : undefined);
  const classes = ["markdown-table-wrap", scroll.overflow ? "scrolls" : "", scroll.overflow && !scroll.start ? "scrolled" : "", scroll.overflow && !scroll.end ? "more" : ""].filter(Boolean).join(" ");
  return <div className={classes} ref={ref} role={scroll.overflow ? "region" : undefined} aria-label={scroll.overflow ? `Table: ${header.slice(0, 3).join(", ")}. Scrolls sideways.` : undefined} tabIndex={scroll.overflow ? 0 : undefined} data-cols={header.length}>
    <table>
      <thead><tr>{header.map((cell, column) => <th key={column} scope="col" style={cellAlign(column) ? { textAlign: cellAlign(column) } : undefined} className={numeric[column] ? "num" : undefined}><InlineText text={cell} taskId={taskId} /></th>)}</tr></thead>
      <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, column) => column === 0
        ? <th key={column} scope="row"><InlineText text={row[column] || ""} taskId={taskId} /></th>
        : <td key={column} style={cellAlign(column) ? { textAlign: cellAlign(column) } : undefined} className={numeric[column] ? "num" : undefined}><InlineText text={row[column] || ""} taskId={taskId} /></td>)}</tr>)}</tbody>
    </table>
  </div>;
}

/** Copies text, falling back to a hidden textarea where the async clipboard API is missing (older iOS, http). */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch { return false; }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(code);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  };
  return <div className="markdown-code">
    <div className="markdown-code-head">
      <span>{language || "code"}</span>
      <button type="button" className="markdown-copy" onClick={() => void copy()} aria-label={state === "copied" ? "Copied" : `Copy ${language || "code"}`}>
        {state === "copied" ? <Check size={14} /> : <Copy size={14} />}<span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Press and hold to copy" : "Copy"}</span>
      </button>
    </div>
    <pre><code>{code}</code></pre>
  </div>;
}

/** Text with fenced code blocks pulled out. An unclosed fence (still streaming) renders as code too. */
function Blocks({ content, taskId }: { content: string; taskId?: string }) {
  const blocks: React.ReactNode[] = [];
  const pattern = /```([^\n]*)\n([\s\S]*?)(?:```|$(?![\s\S]))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    if (match[0].length === 0) { pattern.lastIndex += 1; continue; }
    if (match.index > cursor) blocks.push(<RichTextBlocks key={`text-${cursor}`} text={content.slice(cursor, match.index)} taskId={taskId} />);
    blocks.push(<CodeBlock key={`code-${match.index}`} language={match[1].trim()} code={match[2].replace(/\n$/, "")} />);
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) blocks.push(<RichTextBlocks key={`text-${cursor}`} text={content.slice(cursor)} taskId={taskId} />);
  return <>{blocks}</>;
}

/** One foldable section of a long answer. Starts open for the first section, or for every section of a reply that streamed in live. */
function Section({ title, level, body, initiallyOpen, taskId }: { title: string; level: number; body: string; initiallyOpen: boolean; taskId?: string }) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return <section className={`el-md-section${open ? " open" : ""}`} data-level={level}>
    <h3 className="el-md-section-title">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span><InlineText text={title} taskId={taskId} /></span><ChevronDown size={16} aria-hidden="true" />
      </button>
    </h3>
    <div className="el-md-section-body" id={id} hidden={!open}><Blocks content={body} taskId={taskId} /></div>
  </section>;
}

/**
 * Renders assistant markdown. `collapsible` folds long answers with two or more headings into sections
 * (chat bubbles); `streaming` keeps every section open while the reply is still arriving.
 */
export default function MarkdownMessage({ content, taskId, collapsible = false, streaming = false }: { content: string; taskId?: string; collapsible?: boolean; streaming?: boolean }) {
  const text = visibleReply(content);
  const split = collapsible ? splitSections(text) : null;
  if (split) {
    return <div className="markdown-message has-sections">
      {split.lead ? <Blocks content={split.lead} taskId={taskId} /> : null}
      {split.sections.map((section, index) => <Section key={index} {...section} initiallyOpen={streaming || index === 0} taskId={taskId} />)}
    </div>;
  }
  return <div className="markdown-message"><Blocks content={text} taskId={taskId} /></div>;
}
