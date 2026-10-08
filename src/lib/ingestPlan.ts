import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/lib/db";
import { realInsideRoot } from "@/lib/fsRoot";
import { findByPath } from "@/lib/library";
import {
  walk, classify, stem, selectWork, fileHashOf, hasIngestibleContent, subdirs,
} from "@/lib/rag/sources/coursera";
import type { CourseAnalysis, FileCounts, ItemAnalysis, LibraryAnalysis, SkippedEntry } from "@/lib/ingestPlanTypes";

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
export async function analyzeLibrary(dir: string, whisper = false): Promise<LibraryAnalysis> {
  const { dirs, skipped } = await libraryEntries(dir);
  const items: ItemAnalysis[] = [];
  for (const s of dirs) {
    const it = await analyzeFolder(s, { whisper });
    if (it) items.push(it);
  }
  return { items, skipped };
}

const isInside = (child: string, parent: string) => child.startsWith(parent + path.sep);

/**
 * Analisi di una cartella scelta in /add. La cartella-libreria (anche scelta col browser)
 * è una libreria; una sua cartella madre pure, con la libreria espansa al suo posto: così
 * i corsi lì dentro non diventano mai «un macro chiamato Courses». Altrimenti un elemento solo.
 */
export async function analyzePath(
  dir: string,
  opts: { libraryDir: string; whisper?: boolean }
): Promise<LibraryAnalysis> {
  const whisper = !!opts.whisper;
  if (dir === opts.libraryDir) return analyzeLibrary(dir, whisper);
  if (isInside(opts.libraryDir, dir)) {
    const { dirs, skipped } = await libraryEntries(dir);
    const items: ItemAnalysis[] = [];
    for (const s of dirs) {
      if (s === opts.libraryDir || isInside(opts.libraryDir, s)) {
        const sub = await analyzePath(s, opts);
        items.push(...sub.items); skipped.push(...sub.skipped);
      } else { const it = await analyzeFolder(s, { whisper }); if (it) items.push(it); }
    }
    return { items, skipped };
  }
  const it = await analyzeFolder(dir, { whisper });
  return { items: it ? [it] : [], skipped: [] };
}

/** Rilevamento economico per la Libreria: niente hashing, solo path non ancora domini. */
export async function newInLibrary(dir: string): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string }[] = [];
  for (const s of (await libraryEntries(dir)).dirs) {
    if (findByPath(s)) continue;
    const kind = await classifyFolder(s);
    if (!kind) continue;
    // Macro mai importato come tale ma con tutti i corsi già nel DB (sotto un altro macro o
    // sciolti): non c'è niente di nuovo, altrimenti il banner lo segnalerebbe per sempre.
    if (kind === "macro" && (await contentSubdirs(s, false)).every((c) => findByPath(c))) continue;
    out.push({ path: s, name: path.basename(s) });
  }
  return out;
}

/**
 * Sottocartelle (non nascoste) di una cartella-libreria. Chi copia i corsi può anche
 * linkarli: si segue solo ciò il cui percorso reale sta nella sandbox (lib/fsRoot.ts),
 * il resto finisce in `skipped` con il motivo, così l'anteprima lo può dire.
 */
async function libraryEntries(dir: string): Promise<{ dirs: string[]; skipped: SkippedEntry[] }> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return { dirs: [], skipped: [] }; } // cartella-libreria assente: nessun elemento
  const dirs: string[] = [];
  const skipped: SkippedEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const st = await fs.stat(full).catch(() => null);
    if (!st) skipped.push({ name: e.name, reason: "link simbolico rotto" });
    else if (!st.isDirectory()) continue; // link a un file: non è un corso
    // Anche le cartelle vere: la libreria stessa può essere un link verso fuori sandbox,
    // e l'import (parsePlan) le rifiuterebbe dopo averle proposte.
    else if (!realInsideRoot(full)) skipped.push({ name: e.name, reason: "il percorso reale è fuori dalla cartella consentita" });
    else dirs.push(full);
  }
  return { dirs: dirs.sort((a, b) => a.localeCompare(b)), skipped };
}
