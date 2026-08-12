"use client";

import JSZip from "jszip";
import {
  Archive,
  FileCode2,
  FileText,
  Image as ImageIcon,
  UploadCloud,
} from "lucide-react";
import { useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

type FileItem = {
  name: string;
  content?: string;
};

export default function FilesScreen() {
  const [items, setItems] = useState<FileItem[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function add(list: FileList | null) {
    if (!list) return;

    const arr: FileItem[] = [];

    for (const f of Array.from(list)) {
      if (f.name.endsWith(".zip")) {
        const z = await JSZip.loadAsync(f);

        for (const [n, o] of Object.entries(z.files)) {
          if (!o.dir) {
            arr.push({
              name: n,
              content: await o.async("string"),
            });
          }
        }
      } else {
        try {
          arr.push({
            name: f.name,
            content: await f.text(),
          });
        } catch {
          arr.push({
            name: f.name,
          });
        }
      }
    }

    setItems((x) => [...x, ...arr]);
  }

  return (
    <AppShell title="Files">
      <main className="screen">
        <ScreenHeader title="Artifacts / files" />

        <button
          className="upload-drop"
          onClick={() => input.current?.click()}
        >
          <UploadCloud size={25} />

          <b>upload files or a ZIP</b>

          <small>
            ELIAS can inspect the files and return a new ZIP.
          </small>

          <span>choose files</span>
        </button>

        <input
          ref={input}
          hidden
          type="file"
          multiple
          accept=".zip,.ts,.tsx,.js,.jsx,.html,.css,.md,.txt,.pdf,.docx"
          onChange={(e) => void add(e.target.files)}
        />

        <div className="file-list">
          {items.map((x, i) => (
            <div
              className="file-row"
              key={`${x.name}-${i}`}
            >
              <span className="file-icon">
                {x.name.endsWith(".zip") ? (
                  <Archive size={17} />
                ) : x.name.match(/\.(png|jpg|jpeg|webp)$/i) ? (
                  <ImageIcon size={17} />
                ) : x.name.match(/\.(tsx|ts|jsx|js|css|html)$/i) ? (
                  <FileCode2 size={17} />
                ) : (
                  <FileText size={17} />
                )}
              </span>

              <span>
                <strong>{x.name}</strong>

                <small>
                  {x.content
                    ? `${x.content.length.toLocaleString()} chars`
                    : "binary file"}
                </small>
              </span>
            </div>
          ))}
        </div>
      </main>
    </AppShell>
  );
}