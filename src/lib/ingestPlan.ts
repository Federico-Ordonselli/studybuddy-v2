import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/lib/db";
import { findByPath } from "@/lib/library";
import {
  walk, classify, stem, selectWork, fileHashOf, hasIngestibleContent, subdirs,
} from "@/lib/rag/sources/coursera";
import type { CourseAnalysis, FileCounts, ItemAnalysis } from "@/lib/ingestPlanTypes";

/**
 * Analisi delle cartelle per l'import (sola lettura, niente LLM): classifica macro vs
 * corso, conta i file, confronta gli hash con l'ultimo import. Regola generica, non
 * legata a un corso: sottocartelle numerate = moduli (⇒ corso), con nomi = corsi (⇒ macro).
 */
const NUMBERED = /^\d+[\s._-]/;

async function contentSubdirs(dir: string, whisper: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const s of await subdirs(dir)) if (await hasIngestibleContent(s, whisper)) out.push(s);
  return out.sort((a, b) => a.localeCompare(b));
}

export async function classifyFolder(dir: string, whisper = false): Promise<"macro" | "course" | null> {
  const subs = await contentSubdirs(dir, whisper);
  if (!subs.length) return (await hasIngestibleContent(dir, whisper)) ? "course" : null;
  const numbered = subs.filter((s) => NUMBERED.test(path.basename(s))).length;
  return numbered >= subs.length - numbered ? "course" : "macro"; // parità ⇒ corso
}

/** Hash già noti per un dominio: ingested_files ∪ documents.meta.fileHash (DB precedenti). */
function knownHashes(domainId: number): Map<string, string> {
  const m = new Map<string, string>();
  const docs = sqlite.prepare(
    "SELECT source, json_extract(meta, '$.fileHash') AS h FROM documents WHERE domain_id = ? AND source IS NOT NULL"
  ).all(domainId) as { source: string; h: string | null }[];
  for (const d of docs) if (d.h) m.set(d.source, d.h);
  const files = sqlite.prepare("SELECT source, file_hash AS h FROM ingested_files WHERE domain_id = ?").all(domainId) as { source: string; h: string }[];
  for (const f of files) m.set(f.source, f.h);
  return m;
}

async function analyzeCourse(dir: string, whisper: boolean): Promise<CourseAnalysis> {
  const files = await walk(dir);
  const counts: FileCounts = { transcript: 0, html: 0, pdf: 0, text: 0, video: 0 };
  const transcriptStems = new Set<string>();
  for (const f of files) {
    const k = classify(f);
    if (k === "transcript") transcriptStems.add(stem(f));
    if (k !== "skip") counts[k]++;
  }
  const videosWithoutSubs = files.filter((f) => classify(f) === "video" && !transcriptStems.has(stem(f))).length;
  const work = selectWork(files, whisper);

  const existing = findByPath(dir);
  let changedFiles = work.length;
  if (existing) {
    const known = knownHashes(existing.id);
    changedFiles = 0;
    for (const w of work) {
      const h = known.get(w.file);
      if (!h || h !== fileHashOf(await fs.readFile(w.file))) changedFiles++;
    }
  }
  return {
    path: dir,
    name: existing?.name ?? path.basename(dir),
    existingId: existing?.id,
    parentId: existing ? existing.parentId : undefined,
    areas: existing?.areas ?? [],
    counts,
    videosWithoutSubs,
    status: !existing ? "new" : changedFiles ? "changed" : "upToDate",
    changedFiles,
  };
}

export async function analyzeFolder(
  dir: string,
  opts: { as?: "macro" | "course"; whisper?: boolean } = {}
): Promise<ItemAnalysis | null> {
  const whisper = !!opts.whisper;
  const existing = findByPath(dir);
  // Già importata: vale il tipo nel DB (magari corretto a mano nell'anteprima), non l'euristica.
  const known = existing?.kind === "macro" || existing?.kind === "course" ? existing.kind : undefined;
  const kind = opts.as ?? known ?? (await classifyFolder(dir, whisper));
  if (!kind) return null;
  if (kind === "course") {
    const c = await analyzeCourse(dir, whisper);
    return { kind, path: dir, name: c.name, existingId: c.existingId, areas: c.areas, courses: [c] };
  }
  const courses: CourseAnalysis[] = [];
  for (const s of await contentSubdirs(dir, whisper)) courses.push(await analyzeCourse(s, whisper));
  if (!courses.length) return null;
  return {
    kind, path: dir,
    name: existing?.kind === "macro" ? existing.name : path.basename(dir),
    existingId: existing?.kind === "macro" ? existing.id : undefined,
    areas: existing?.kind === "macro" ? existing.areas : [],
    courses,
  };
}

/** La cartella-libreria non è mai un macro: ogni sottocartella è un elemento a sé. */
export async function analyzeLibrary(dir: string, whisper = false): Promise<ItemAnalysis[]> {
  const items: ItemAnalysis[] = [];
  for (const s of await safeSubdirs(dir)) {
    const it = await analyzeFolder(s, { whisper });
    if (it) items.push(it);
  }
  return items;
}

/** Rilevamento economico per la Libreria: niente hashing, solo path non ancora domini. */
export async function newInLibrary(dir: string): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string }[] = [];
  for (const s of await safeSubdirs(dir)) {
    if (findByPath(s)) continue;
    if (await hasIngestibleContent(s)) out.push({ path: s, name: path.basename(s) });
  }
  return out;
}

async function safeSubdirs(dir: string): Promise<string[]> {
  try {
    return (await subdirs(dir)).filter((s) => !path.basename(s).startsWith(".")).sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // cartella-libreria assente: nessun elemento
  }
}
