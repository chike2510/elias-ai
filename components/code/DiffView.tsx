"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileMinus2, FilePen, FilePlus2 } from "lucide-react";
import { diffByFile, type DiffFile } from "@/lib/assistant/code/cards";

const ICON = { added: FilePlus2, deleted: FileMinus2, modified: FilePen } as const;

/** Per-file unified diff, collapsible; lines colored by +/-. Shared by the chat diff card and the workspace Diff tab. */
export function DiffView({ files, diff, openFirst = false }: { files: DiffFile[]; diff?: string; openFirst?: boolean }) {
  const chunks = diff ? diffByFile(diff) : [];
  const [open, setOpen] = useState<Record<string, boolean>>(() => (openFirst && files[0] ? { [files[0].path]: true } : {}));
  return (
    <ul className="v4c-files">
      {files.map((file) => {
        const Icon = ICON[file.status as keyof typeof ICON] || FilePen;
        const chunk = chunks.find((item) => item.path === file.path);
        const expanded = Boolean(open[file.path]);
        return (
          <li key={file.path}>
            <button type="button" className="v4c-file" aria-expanded={expanded} disabled={!chunk} onClick={() => setOpen((prev) => ({ ...prev, [file.path]: !prev[file.path] }))}>
              <Icon size={15} aria-hidden className={`v4c-ic-${file.status}`} />
              <span className="v4c-path" title={file.path}>{file.path}</span>
              <span className="v4c-stat"><b className="v4c-add">+{file.added}</b> <b className="v4c-del">−{file.removed}</b></span>
              {chunk ? (expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />) : null}
            </button>
            {expanded && chunk ? (
              <pre className="v4c-diff" aria-label={`Diff of ${file.path}`}>
                {chunk.lines.map((line, index) => <span key={index} className={line.startsWith("+") ? "v4c-l-add" : line.startsWith("-") ? "v4c-l-del" : line.startsWith("@@") ? "v4c-l-hunk" : undefined}>{line || " "}{"\n"}</span>)}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
