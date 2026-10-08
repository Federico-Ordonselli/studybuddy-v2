import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { parse as parseHtmlDom } from "node-html-parser";
import { db, sqlite } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { indexChunks, deleteDocumentChunks, type ChunkRecord } from "@/lib/rag/store";
import { chunkText, chunkTranscript, type TranscriptCue } from "@/lib/rag/chunk";
import { transcribeToSrt, whisperAvailable } from "@/lib/transcribe";

/**
 * Ingestion di un corso Coursera scaricato (struttura corso/modulo/lezione).
 * Le trascrizioni .srt/.vtt sono la fonte principale; i video si saltano (path solo
 * per il link). pdf/html vengono estratti e indicizzati come testo.
 */

// Versione della logica di parsing/chunking: entra in `fileHash` così che, quando
// migliora un parser, il re-ingest rielabori anche i file il cui contenuto non è
// cambiato (altrimenti verrebbero saltati perché i byte sono identici). Bump = refresh.
const PARSER_VERSION = "4";

/** Hash con cui si riconosce un file già ingerito (contenuto + versione del parser). */
export function fileHashOf(buf: Buffer): string {
  return createHash("sha1").update(PARSER_VERSION).update(buf).digest("hex");
}

export type Kind = "transcript" | "pdf" | "html" | "video" | "text" | "skip";

export function classify(file: string): Kind {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".srt" || ext === ".vtt") return "transcript";
  if (ext === ".pdf") return "pdf";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".mp4" || ext === ".mkv" || ext === ".webm" || ext === ".mov") return "video";
  if (ext === ".txt") return "text";
  return "skip"; // zip/xlsx/docx/url/fig/... non sono testo ingeribile
}

/** Path senza l'ultima estensione: "a/b/01_x.en.srt" -> "a/b/01_x.en". */
export function stem(file: string): string {
  return file.slice(0, file.length - path.extname(file).length);
}

/** "00:01:23,456" o "00:01:23.456" -> secondi. */
function tsToSec(ts: string): number {
  const [h, m, s] = ts.replace(",", ".").split(":");
  return (+h) * 3600 + (+m) * 60 + parseFloat(s);
}

/** Parser SRT/VTT -> cue con timestamp. */
export function parseSubtitles(raw: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  const timeRe = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/;
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() && l.trim() !== "WEBVTT");
    const tline = lines.find((l) => timeRe.test(l));
    if (!tline) continue;
    const m = tline.match(timeRe)!;
    const text = lines
      .filter((l) => !timeRe.test(l) && !/^\d+$/.test(l.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ startSec: tsToSec(m[1]), endSec: tsToSec(m[2]), text });
  }
  return cues;
}

/**
 * Toglie le immagini incorporate come data URI (anche 15 MB in un attributo): non
 * portano testo e con stringhe così lunghe le regex di V8 vanno in stack overflow
 * (sia quella dei tag di node-html-parser sia un `replace` con quantificatore),
 * quindi scansione lineare con indexOf.
 */
function stripDataUris(html: string): string {
  let out = "";
  let i = 0;
  for (let j = html.indexOf("data:", i); j >= 0; j = html.indexOf("data:", i)) {
    // Solo valori di attributo / url(): "metadata: …" nel testo resta intatto.
    if (!`"'(`.includes(html[j - 1])) { out += html.slice(i, j + 5); i = j + 5; continue; }
    let k = j + 5;
    while (k < html.length && html[k] !== '"' && html[k] !== "'" && html[k] !== ")") k++;
    out += html.slice(i, j) + (k - j > 256 ? "data:" : html.slice(j, k));
    i = k;
  }
  return out + html.slice(i);
}

/**
 * Estrae il main content da una reading HTML di Coursera.
 * Le reading vivono in <co-content>; per le pagine senza wrapper si ricade sul body.
 * Si tengono code/pre/tabelle (cheat sheet) e si scartano script/style/svg/chrome.
 */
export function parseHtml(raw: string): string {
  const html = stripDataUris(raw);
  // Senza `pre` fra i blockTextElements (default: script/noscript/style/pre) il
  // contenuto dei <pre> resta markup letterale ("<c- b>interface</c->…").
  const root = parseHtmlDom(html, { comment: false, blockTextElements: { script: true, noscript: true, style: true } });
  root
    .querySelectorAll("script,style,noscript,svg,iframe,link,meta,head,nav,header,footer")
    .forEach((el) => el.remove());
  const main = root.querySelector("co-content") ?? root.querySelector("body") ?? root;
  return main.structuredText
    .split("\n")
    .map((l) => l.replace(/[^\S\n]{2,}/g, " ").trim()) // collassa run di spazi/tab/nbsp
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Estrae il testo da un PDF (slide/reading). unpdf = pdfjs, niente dipendenze native. */
export async function parsePdf(data: Uint8Array): Promise<string> {
  // import dinamico: unpdf è ESM-only e va tenuto fuori dal bundle delle route.
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

/** Hash del contenuto normalizzato, per il dedup a livello di chunk. */
function contentHash(s: string): string {
  return createHash("sha1").update(s.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

/** Trasforma il contenuto di un file (già letto) nei suoi chunk per l'indicizzazione. */
async function recordsFor(file: string, buf: Buffer, kind: Kind): Promise<ChunkRecord[]> {
  switch (kind) {
    case "transcript": {
      const cues = parseSubtitles(buf.toString("utf8"));
      return cues.length ? chunkTranscript(cues) : [];
    }
    case "text":
      return chunkText(buf.toString("utf8")).map((content) => ({ content }));
    case "html":
      return chunkText(parseHtml(buf.toString("utf8"))).map((content) => ({ content }));
    case "pdf":
      return chunkText(await parsePdf(new Uint8Array(buf))).map((content) => ({ content }));
    case "video": {
      // Whisper fallback: trascrive il video → SRT → cue con timestamp.
      const srt = transcribeToSrt(file);
      if (!srt) return [];
      const cues = parseSubtitles(srt);
      return cues.length ? chunkTranscript(cues) : [];
    }
    default:
      return [];
  }
}

/**
 * Indicizza un corso. `courseDir` = root del corso scaricato.
 * Crea un documento per file testuale, con meta gerarchici dedotti dal path.
 *
 * Idempotente: ogni documento porta in `meta.fileHash` l'hash del file sorgente.
 * Su re-ingest i file invariati vengono saltati (niente re-embedding) e quelli
 * modificati vengono sostituiti (vecchio documento + chunk rimossi).
 *
 * Dedup: (1) si salta il .txt quando esiste la trascrizione .srt/.vtt gemella
 * (stesso contenuto, ma l'srt ha i timestamp); (2) si scartano i chunk con
 * contenuto identico già visti nel run (es. stessa reading come html e pdf).
 */
// Priorità di processamento: le fonti più "ricche" vincono il dedup a parità di
// contenuto (la trascrizione porta i timestamp, l'html è strutturato).
const KIND_ORDER: Record<Kind, number> = {
  transcript: 0, html: 1, pdf: 2, text: 3, video: 9, skip: 9,
};

/**
 * I file che l'ingest elabora, in ordine di priorità. Condivisa con l'analisi
 * dell'import (lib/ingestPlan.ts): stessa definizione di "file da ingerire".
 */
export function selectWork(files: string[], useWhisper: boolean): { file: string; kind: Kind }[] {
  // Stem di ogni trascrizione: serve a riconoscere i .txt gemelli e i video già coperti.
  const transcriptStems = new Set<string>();
  for (const f of files) if (classify(f) === "transcript") transcriptStems.add(stem(f));
  return files
    .map((file) => ({ file, kind: classify(file) }))
    .filter(({ file, kind }) => {
      if (kind === "skip") return false;
      // Video: solo col fallback Whisper attivo e se manca la trascrizione gemella.
      if (kind === "video") return useWhisper && !transcriptStems.has(stem(file));
      // .txt gemello di una trascrizione -> ridondante, si tiene l'srt.
      if (kind === "text" && transcriptStems.has(stem(file))) return false;
      return true;
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

function recordIngested(domainId: number, source: string, fileHash: string) {
  sqlite.prepare(
    `INSERT INTO ingested_files (domain_id, source, file_hash) VALUES (?, ?, ?)
     ON CONFLICT(domain_id, source) DO UPDATE SET file_hash = excluded.file_hash`
  ).run(domainId, source, fileHash);
}

export interface IngestOpts {
  whisper?: boolean;
  /** Notifica di avanzamento: (file processati, totale, ultimo file). */
  onProgress?: (done: number, total: number, file: string) => void;
}

export async function ingestCourse(
  courseDir: string,
  domainId: number,
  opts: IngestOpts = {}
) {
  const files = await walk(courseDir);

  // Stem di ogni trascrizione: serve a riconoscere i .txt gemelli e i video già coperti.
  const transcriptStems = new Set<string>();
  for (const f of files) if (classify(f) === "transcript") transcriptStems.add(stem(f));

  const useWhisper = !!opts.whisper && whisperAvailable();
  if (opts.whisper && !useWhisper) {
    console.warn("[ingestCourse] --whisper richiesto ma nessun backend Whisper disponibile: i video senza trascrizione verranno saltati.");
  }

  const work = selectWork(files, useWhisper);

  // Documenti già presenti per questo dominio: source -> { id, fileHash }.
  const existing = new Map<string, { id: number; fileHash?: string }>();
  const prior = await db
    .select({ id: documents.id, source: documents.source, meta: documents.meta })
    .from(documents)
    .where(eq(documents.domainId, domainId));
  for (const d of prior) {
    if (d.source) {
      existing.set(d.source, { id: d.id, fileHash: (d.meta as { fileHash?: string } | null)?.fileHash });
    }
  }

  const seen = new Set<string>(); // hash dei chunk già indicizzati nel run
  const stats = {
    documents: 0, chunks: 0, unchanged: 0, replaced: 0,
    dedupedChunks: 0, skippedTxtTwins: 0, transcribed: 0, errors: 0,
  };
  stats.skippedTxtTwins = files.filter(
    (f) => classify(f) === "text" && transcriptStems.has(stem(f))
  ).length;

  for (let wi = 0; wi < work.length; wi++) {
    const { file, kind } = work[wi];
    opts.onProgress?.(wi, work.length, path.relative(courseDir, file));
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (e) {
      stats.errors++;
      console.warn(`[ingestCourse] skip ${path.relative(courseDir, file)}: ${e}`);
      continue;
    }
    const fileHash = fileHashOf(buf);

    const prev = existing.get(file);
    if (prev && prev.fileHash === fileHash) { recordIngested(domainId, file, fileHash); stats.unchanged++; continue; } // invariato

    if (kind === "video") console.log(`[ingestCourse] trascrivo (whisper): ${path.relative(courseDir, file)} …`);
    let records: ChunkRecord[];
    try {
      records = await recordsFor(file, buf, kind);
    } catch (e) {
      stats.errors++;
      console.warn(`[ingestCourse] skip ${path.relative(courseDir, file)}: ${e}`);
      continue;
    }
    if (kind === "video" && records.length) stats.transcribed++;

    // Dedup a livello di chunk.
    const fresh: ChunkRecord[] = [];
    for (const r of records) {
      const h = contentHash(r.content);
      if (seen.has(h)) { stats.dedupedChunks++; continue; }
      seen.add(h);
      fresh.push(r);
    }

    // File modificato (o ora senza contenuto): rimuovi la versione precedente.
    if (prev) {
      deleteDocumentChunks(prev.id);
      await db.delete(documents).where(eq(documents.id, prev.id));
      stats.replaced++;
    }
    // Registrato anche se non produce chunk (l'analisi non lo rivede come "nuovo"),
    // ma solo dopo un'indicizzazione riuscita: un embed fallito lascia il file "modificato".
    if (!fresh.length) { recordIngested(domainId, file, fileHash); continue; }

    const rel = path.relative(courseDir, file);
    const crumbs = rel.split(path.sep).slice(0, -1); // tutte le cartelle sotto courseDir
    // Un video trascritto è a tutti gli effetti una trascrizione (con link al video).
    const docKind = kind === "video" ? "transcript" : kind;
    const meta = {
      course: path.basename(courseDir),
      module: crumbs[0] ?? null,
      lesson: crumbs.length > 1 ? crumbs[crumbs.length - 1] : null,
      crumbs, // breadcrumb completa, indipendente dalla profondità
      path: file,
      fileHash,
      ...(kind === "video" ? { transcribedByWhisper: true } : {}),
    };

    const [doc] = await db
      .insert(documents)
      .values({ domainId, title: path.basename(file), source: file, kind: docKind, meta })
      .returning({ id: documents.id });
    await indexChunks(doc.id, fresh);
    recordIngested(domainId, file, fileHash);
    stats.documents++;
    stats.chunks += fresh.length;
  }

  opts.onProgress?.(work.length, work.length, "");
  return stats;
}

/** Una directory ha materiale ingeribile (transcript/text/html/pdf, o video se whisper)? */
export async function hasIngestibleContent(dir: string, whisper = false): Promise<boolean> {
  for (const file of await walk(dir)) {
    const kind = classify(file);
    if (kind === "skip") continue;
    if (kind === "video") { if (whisper) return true; continue; }
    return true;
  }
  return false;
}

/** Sottocartelle immediate (per lo split macro→micro). */
export async function subdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
}
