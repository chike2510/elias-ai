"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

function InlineText({ text, taskId }: { text: string; taskId?: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^\)]+\)|\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        const markdownLink = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
        if (markdownLink) {
          const [, label, rawHref] = markdownLink;
          const href = rawHref.startsWith("/artifacts/") && taskId ? `/api/tasks/${encodeURIComponent(taskId)}/artifact/${rawHref.slice("/artifacts/".length)}` : rawHref;
          return <a key={index} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined} download={href.startsWith("/api/tasks/")}>{label}</a>;
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\//, "")}</a>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function TextBlock({ text, taskId }: { text: string; taskId?: string }) {
  return (
    <div className="markdown-text">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>
          {paragraph.split("\n").map((line, lineIndex) => (
              <span key={lineIndex}>
              {lineIndex ? <br /> : null}
              <InlineText text={line} taskId={taskId} />
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

export default function MarkdownMessage({ content, taskId }: { content: string; taskId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const blocks: React.ReactNode[] = [];
  const pattern = /```([^\n]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content))) {
    if (match.index > cursor) blocks.push(<TextBlock key={`text-${cursor}`} text={content.slice(cursor, match.index)} taskId={taskId} />);
    const language = match[1].trim();
    const code = match[2].replace(/\n$/, "");
    blocks.push(
      <div className="markdown-code" key={`code-${match.index}`}>
        <div className="markdown-code-head">
          <span>{language || "code"}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              setCopied(code);
              window.setTimeout(() => setCopied((current) => current === code ? null : current), 1400);
            }}
          >
            {copied === code ? <Check size={13} /> : <Copy size={13} />}
            {copied === code ? "copied" : "copy"}
          </button>
        </div>
        <pre><code>{code}</code></pre>
      </div>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) blocks.push(<TextBlock key={`text-${cursor}`} text={content.slice(cursor)} taskId={taskId} />);
  return <div className="markdown-message">{blocks.length ? blocks : <TextBlock text={content} taskId={taskId} />}</div>;
}
