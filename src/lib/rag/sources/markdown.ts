import { chunkText } from "@/lib/rag/chunk";
import type { ChunkRecord } from "@/lib/rag/store";

/**
 * Markdown come fonte dell'ingest: il testo resta Markdown (il modello lo legge bene), diviso per titoli
 * fino al livello 3. I titoli più profondi restano dentro la sezione; i `#` nei blocchi di codice non contano.
 * Ogni chunk inizia con il percorso dei titoli ("Capitolo 1 › 1. Sistemi") e lo porta in `meta.section`,
 * così il retrieval vede il contesto e le citazioni dicono da quale sezione viene il passaggio.
 */

export interface MarkdownSection { path: string[]; body: string }

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const MAX_LEVEL = 3;

function stripFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function markdownSections(raw: string): MarkdownSection[] {
  const lines = stripFrontmatter(raw.replace(/^﻿/, "")).split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const stack: { level: number; title: string }[] = [];
  let body: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    sections.push({ path: stack.map((h) => h.title), body: body.join("\n").trim() });
    body = [];
  };
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      body.push(line);
      continue;
    }
    const h = fence ? null : HEADING.exec(line);
    if (h && h[1].length <= MAX_LEVEL) {
      if (stack.length || body.join("").trim()) flush();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: h[2].replace(/\s*\{[^{}]*\}\s*$/, "").trim() });
      continue;
    }
    body.push(line);
  }
  flush();
  return sections.filter((s) => s.path.length || s.body);
}

export function markdownRecords(raw: string): ChunkRecord[] {
  const out: ChunkRecord[] = [];
  for (const s of markdownSections(raw)) {
    if (!s.body) continue;
    const section = s.path.join(" › ");
    for (const piece of chunkText(s.body)) {
      out.push(section ? { content: `${section}\n\n${piece}`, meta: { section } } : { content: piece });
    }
  }
  return out;
}
