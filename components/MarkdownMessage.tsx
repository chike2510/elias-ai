"use client";

import { Check, Copy } from "lucide-react";
import { Fragment, useState } from "react";

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
      index += 2;
      const body: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) { body.push(cells(lines[index])); index += 1; }
      output.push(<div className="markdown-table-wrap" key={`table-${key++}`}><table><thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}><InlineText text={cell} taskId={taskId} /></th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}><InlineText text={row[cellIndex] || ""} taskId={taskId} /></td>)}</tr>)}</tbody></table></div>);
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

export default function MarkdownMessage({ content, taskId }: { content: string; taskId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const blocks: React.ReactNode[] = [];
  const pattern = /```([^\n]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    if (match.index > cursor) blocks.push(<RichTextBlocks key={`text-${cursor}`} text={content.slice(cursor, match.index)} taskId={taskId} />);
    const language = match[1].trim();
    const code = match[2].replace(/\n$/, "");
    blocks.push(<div className="markdown-code" key={`code-${match.index}`}><div className="markdown-code-head"><span>{language || "code"}</span><button type="button" onClick={() => { void navigator.clipboard?.writeText(code); setCopied(code); window.setTimeout(() => setCopied((current) => current === code ? null : current), 1400); }}>{copied === code ? <Check size={13} /> : <Copy size={13} />}{copied === code ? "copied" : "copy"}</button></div><pre><code>{code}</code></pre></div>);
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) blocks.push(<RichTextBlocks key={`text-${cursor}`} text={content.slice(cursor)} taskId={taskId} />);
  return <div className="markdown-message">{blocks.length ? blocks : <RichTextBlocks text={content} taskId={taskId} />}</div>;
}
