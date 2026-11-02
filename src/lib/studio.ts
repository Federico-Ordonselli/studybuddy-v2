import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/lib/db";
import { LibraryError } from "@/lib/errors";
import { saveCards } from "@/lib/tutor/cards";
import type {
  Chapter, CodeBlock, Lesson, QuizQuestion, Section, Segment, ServedQuestion, StudioLessonSummary, StudioState, Study, Visual,
} from "@/lib/studioTypes";

/**
 * Lezioni audio Full Studio dentro StudyBuddy. Un pacchetto sta nella cartella di un corso come
 * `<modulo>/studio/lesson.json` (+ `study.json` facoltativo, + `audio/…` relativi a `studio/`): lo registra
 * l'ingest del corso, senza chunk (il testo da studiare arriva dal .md o dall'HTML accanto).
 * Le carte di `study.json` nascono sospese e si sbloccano quando la loro sezione è ascoltata: così il
 * ripasso, i conteggi e i badge restano le query di sempre (`suspended = 0`).
 */

type Obj = Record<string, unknown>;
const bad = (what: string): never => { throw new LibraryError(`Lezione Full Studio non valida: ${what}`); };
const obj = (v: unknown, what: string): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : bad(what));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(what));
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : bad(what));
const optStr = (v: unknown, what: string) => (v == null ? undefined : str(v, what));
const strings = (v: unknown, what: string) => arr(v, what).map((x) => str(x, what));

function quizQuestion(v: unknown, what: string): QuizQuestion {
  const q = obj(v, what);
  const options = strings(q.options, `${what}: opzioni`);
  const answer = q.answer;
  if (options.length < 2 || typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) bad(`${what}: risposta`);
  return { q: str(q.q, `${what}: domanda`), options, answer: answer as number, why: str(q.why ?? "", `${what}: spiegazione`) };
}

function visual(v: unknown, what: string): Visual | null {
  if (v == null) return null;
  const x = obj(v, what);
  if (x.kind === "table") return { kind: "table", title: str(x.title ?? "", what), headers: strings(x.headers, what), rows: arr(x.rows, what).map((r) => strings(r, what)) };
  if (x.kind === "list") return { kind: "list", title: str(x.title ?? "", what), ordered: !!x.ordered, items: strings(x.items, what) };
  return bad(`${what}: tipo ${String(x.kind)}`);
}

/** Valida un lesson.json (forma della pipeline Full Studio); tiene solo i campi che il player usa. */
export function parseLesson(value: unknown): Lesson {
  const l = obj(value, "radice");
  const codeBlocks: Record<string, CodeBlock> = {};
  for (const [ref, c] of Object.entries(obj(l.codeBlocks ?? {}, "codeBlocks"))) {
    const b = obj(c, `codice ${ref}`);
    codeBlocks[ref] = { lang: str(b.lang ?? "", `codice ${ref}`), code: str(b.code, `codice ${ref}`), file: optStr(b.file, `codice ${ref}`) };
  }
  const ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) bad(`id duplicato ${id}`); ids.add(id); return id; };
  const chapters: Chapter[] = arr(l.chapters, "capitoli").map((cv, ci) => {
    const c = obj(cv, `capitolo ${ci}`);
    const sections: Section[] = arr(c.sections, `capitolo ${ci}: sezioni`).map((sv, si) => {
      const s = obj(sv, `sezione ${ci}.${si}`);
      const segments: Segment[] = arr(s.segments, `sezione ${ci}.${si}: segmenti`).map((gv) => {
        const g = obj(gv, "segmento");
        const id = unique(str(g.id, "segmento: id"));
        let code: Segment["code"] = null;
        if (g.code != null) {
          const cd = obj(g.code, `segmento ${id}: codice`);
          const ref = str(cd.ref, `segmento ${id}: codice`);
          if (!codeBlocks[ref]) bad(`segmento ${id}: codice ${ref} mancante`);
          const h = cd.highlight;
          const highlight = Array.isArray(h) && h.length === 2 && h.every((n) => Number.isInteger(n) && (n as number) > 0) ? [h[0], h[1]] as [number, number] : null;
          code = { ref, highlight };
        }
        const duration = typeof g.duration === "number" && Number.isFinite(g.duration) && g.duration >= 0 ? g.duration : undefined;
        return { id, text: str(g.text, `segmento ${id}: testo`), tts: optStr(g.tts, "tts"), code, visual: visual(g.visual, `segmento ${id}: visual`), audio: optStr(g.audio, "audio"), duration };
      });
      return { id: unique(str(s.id, "sezione: id")), title: str(s.title, "sezione: titolo"), group: optStr(s.group, "gruppo") ?? null, segments };
    });
    const quiz = c.quiz == null ? [] : arr(c.quiz, "quiz").map((q, i) => quizQuestion(q, `quiz ${ci}.${i}`));
    return { id: unique(str(c.id, "capitolo: id")), title: str(c.title, "capitolo: titolo"), sections, quiz };
  });
  if (!chapters.some((c) => c.sections.some((s) => s.segments.length))) bad("nessun segmento");
  return {
    part: typeof l.part === "number" ? l.part : 0,
    title: str(l.title, "titolo"),
    subtitle: str(l.subtitle ?? "", "sottotitolo"),
    voice: optStr(l.voice, "voce"),
    rate: optStr(l.rate, "rate"),
    chapters,
    codeBlocks,
  };
}

const sectionIds = (lesson: Lesson) => lesson.chapters.flatMap((c) => c.sections.map((s) => s.id));

/** Valida study.json contro la lezione: ogni sezione citata deve esistere. */
export function parseStudy(value: unknown, lesson: Lesson): Study {
  const v = obj(value, "study.json");
  if (v.version !== 1) bad("study.json: versione");
  const known = new Set(sectionIds(lesson));
  const sections: Study["sections"] = {};
  for (const [id, sv] of Object.entries(obj(v.sections, "study.json: sezioni"))) {
    if (!known.has(id)) bad(`study.json: sezione sconosciuta ${id}`);
    const s = obj(sv, `study.json ${id}`);
    sections[id] = {
      cards: s.cards == null ? [] : arr(s.cards, `${id}: carte`).map((c, i) => {
        const x = obj(c, `${id}: carta ${i}`);
        return { q: str(x.q, `${id}: carta ${i}`).trim(), a: str(x.a, `${id}: carta ${i}`).trim() };
      }),
      quiz: s.quiz == null ? [] : arr(s.quiz, `${id}: quiz`).map((q, i) => quizQuestion(q, `${id}: quiz ${i}`)),
    };
  }
  return { version: 1, sections };
}

/** `…/studio/lesson.json`: il file che l'ingest tratta come pacchetto lezione. */
export function isStudioLessonPath(file: string): boolean {
  return path.basename(file) === "lesson.json" && path.basename(path.dirname(file)) === "studio";
}

export const studyPathFor = (lessonPath: string) => path.join(path.dirname(lessonPath), "study.json");

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (e) { throw new LibraryError(`Lezione Full Studio non leggibile: ${path.basename(file)} (${(e as Error).message})`); }
}

async function readStudy(lessonPath: string, lesson: Lesson): Promise<Study | null> {
  const p = studyPathFor(lessonPath);
  const exists = await fs.stat(p).then((s) => s.isFile(), () => false);
  return exists ? parseStudy(await readJson(p), lesson) : null;
}

const emptyState = (): StudioState => ({ segmentId: null, offset: 0, rate: 1, completedSections: [] });

function storedState(lessonId: number): StudioState {
  const row = sqlite.prepare("SELECT state FROM studio_progress WHERE lesson_id = ?").get(lessonId) as { state: string } | undefined;
  if (!row) return emptyState();
  try {
    const s = JSON.parse(row.state) as Partial<StudioState>;
    return {
      segmentId: typeof s.segmentId === "string" ? s.segmentId : null,
      offset: typeof s.offset === "number" && s.offset >= 0 ? s.offset : 0,
      rate: typeof s.rate === "number" ? s.rate : 1,
      completedSections: Array.isArray(s.completedSections) ? s.completedSections.filter((x): x is string => typeof x === "string") : [],
    };
  } catch { return emptyState(); }
}

export const sectionKey = (lessonId: number, sectionId: string) => `${lessonId}:${sectionId}`;

/**
 * Registra (o aggiorna) un pacchetto lezione per il corso e ne importa domande e carte.
 * Idempotente: le domande si riscrivono, le carte già presenti nel corso sono saltate da `saveCards`.
 */
export async function importStudioLesson(domainId: number, lessonPath: string) {
  if (!isStudioLessonPath(lessonPath)) throw new LibraryError("Il pacchetto lezione deve essere studio/lesson.json");
  const lesson = parseLesson(await readJson(lessonPath));
  const study = await readStudy(lessonPath, lesson);
  const sections = sectionIds(lesson);
  const duration = lesson.chapters.reduce((t, c) => t + c.sections.reduce((u, s) => u + s.segments.reduce((v, g) => v + (g.duration ?? 0), 0), 0), 0);
  const lessonId = sqlite.transaction(() => {
    const row = sqlite.prepare(
      `INSERT INTO studio_lessons (domain_id, path, title, sections, duration, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET domain_id = excluded.domain_id, title = excluded.title, sections = excluded.sections, duration = excluded.duration
       RETURNING id`,
    ).get(domainId, lessonPath, lesson.title, sections.length, duration, Math.floor(Date.now() / 1000)) as { id: number };
    sqlite.prepare("DELETE FROM studio_quiz WHERE lesson_id = ?").run(row.id);
    const insert = sqlite.prepare("INSERT INTO studio_quiz (lesson_id, section_id, ordinal, question) VALUES (?, ?, ?, ?)");
    for (const chapter of lesson.chapters) {
      chapter.sections.forEach((s) => (study?.sections[s.id]?.quiz ?? []).forEach((q, i) => insert.run(row.id, s.id, i, JSON.stringify(q))));
      // Il quiz di fine capitolo si apre con l'ultima sezione del capitolo (ordinali dopo quelli della sezione).
      const last = chapter.sections[chapter.sections.length - 1];
      if (last) (chapter.quiz ?? []).forEach((q, i) => insert.run(row.id, last.id, 1000 + i, JSON.stringify(q)));
    }
    return row.id;
  })();
  const done = new Set(storedState(lessonId).completedSections);
  const items = sections.flatMap((id) => (study?.sections[id]?.cards ?? []).map((c) => ({
    question: c.q, answer: c.a, studioSection: sectionKey(lessonId, id), locked: !done.has(id),
  })));
  const cardsResult = items.length ? saveCards(domainId, items) : { created: 0, skipped: 0 };
  const quiz = (sqlite.prepare("SELECT count(*) AS n FROM studio_quiz WHERE lesson_id = ?").get(lessonId) as { n: number }).n;
  return { lessonId, cards: cardsResult, quiz };
}

interface LessonRow { id: number; domain_id: number; path: string; title: string; sections: number; duration: number }

function lessonRow(id: number): LessonRow {
  const row = Number.isSafeInteger(id)
    ? sqlite.prepare("SELECT id, domain_id, path, title, sections, duration FROM studio_lessons WHERE id = ?").get(id) as LessonRow | undefined
    : undefined;
  if (!row) throw new LibraryError("Lezione non trovata", 404);
  return row;
}

/** Lezione completa per il player, con lo stato di ascolto salvato. */
export async function getLesson(id: number) {
  const row = lessonRow(id);
  const lesson = parseLesson(await readJson(row.path));
  const course = sqlite.prepare("SELECT id, name FROM domains WHERE id = ?").get(row.domain_id) as { id: number; name: string };
  return { id: row.id, course, lesson, state: storedState(row.id), counts: cardCounts(row.id) };
}

function cardCounts(lessonId: number) {
  const r = sqlite.prepare(
    `SELECT count(*) AS total, coalesce(sum(CASE WHEN suspended = 0 THEN 1 ELSE 0 END), 0) AS unlocked
     FROM cards WHERE studio_section LIKE ? ESCAPE '\\'`,
  ).get(`${lessonId}:%`) as { total: number; unlocked: number };
  return { cardsTotal: r.total, cardsUnlocked: r.unlocked };
}

/**
 * Salva il punto di ascolto. Le sezioni completate si sommano a quelle già salvate (non tornano indietro);
 * per quelle nuove le carte si sbloccano. Le carte sospese a mano dopo lo sblocco restano sospese.
 */
export async function saveState(id: number, input: unknown) {
  const row = lessonRow(id);
  const v = obj(input, "stato");
  const lesson = parseLesson(await readJson(row.path));
  const known = new Set(sectionIds(lesson));
  const segments = new Set(lesson.chapters.flatMap((c) => c.sections.flatMap((s) => s.segments.map((g) => g.id))));
  const prev = storedState(row.id);
  const incoming = Array.isArray(v.completedSections) ? v.completedSections.filter((x): x is string => typeof x === "string" && known.has(x)) : [];
  const before = new Set(prev.completedSections);
  const added = [...new Set(incoming)].filter((x) => !before.has(x));
  const order = sectionIds(lesson);
  const state: StudioState = {
    segmentId: typeof v.segmentId === "string" && segments.has(v.segmentId) ? v.segmentId : prev.segmentId,
    offset: typeof v.offset === "number" && Number.isFinite(v.offset) && v.offset >= 0 ? v.offset : 0,
    rate: typeof v.rate === "number" && Number.isFinite(v.rate) ? Math.min(2, Math.max(0.75, v.rate)) : prev.rate,
    completedSections: order.filter((s) => before.has(s) || added.includes(s)),
  };
  let unlocked = 0;
  sqlite.transaction(() => {
    sqlite.prepare(
      `INSERT INTO studio_progress (lesson_id, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(lesson_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ).run(row.id, JSON.stringify(state), Math.floor(Date.now() / 1000));
    const unlock = sqlite.prepare("UPDATE cards SET suspended = 0 WHERE studio_section = ? AND suspended = 1");
    for (const s of added) unlocked += unlock.run(sectionKey(row.id, s)).changes;
  })();
  return { state, unlocked, counts: cardCounts(row.id) };
}

/** Elenco delle lezioni registrate, con avanzamento e carte sbloccate. */
export function listLessons(): StudioLessonSummary[] {
  const rows = sqlite.prepare(
    `SELECT l.id, l.title, l.sections, l.duration, l.domain_id AS courseId, d.name AS courseName, p.name AS parentName,
            pr.state AS state, pr.updated_at AS updatedAt,
            (SELECT count(*) FROM studio_quiz q WHERE q.lesson_id = l.id) AS quiz
     FROM studio_lessons l JOIN domains d ON d.id = l.domain_id LEFT JOIN domains p ON p.id = d.parent_id
     LEFT JOIN studio_progress pr ON pr.lesson_id = l.id
     ORDER BY coalesce(p.name, d.name) COLLATE NOCASE, d.name COLLATE NOCASE, l.path`,
  ).all() as (Omit<StudioLessonSummary, "completed" | "cardsTotal" | "cardsUnlocked" | "subtitle"> & { state: string | null })[];
  return rows.map(({ state, ...r }) => {
    let completed = 0;
    try { completed = state ? (JSON.parse(state).completedSections ?? []).length : 0; } catch { /* stato illeggibile = da capo */ }
    return { ...r, subtitle: "", completed, ...cardCounts(r.id) };
  });
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Quiz su ciò che hai ascoltato: solo domande delle sezioni completate. Metà (arrotondata per eccesso) dalle
 * ultime due sezioni completate nell'ordine della lezione, il resto dalle precedenti; se una parte non basta
 * si riempie con l'altra. Opzioni rimescolate.
 */
export async function quizPool(id: number, n = 10, random: () => number = Math.random): Promise<ServedQuestion[]> {
  const row = lessonRow(id);
  const lesson = parseLesson(await readJson(row.path));
  const titles = new Map(lesson.chapters.flatMap((c) => c.sections.map((s) => [s.id, s.title] as const)));
  const done = storedState(row.id).completedSections;
  if (!done.length) return [];
  const marks = done.map(() => "?").join(",");
  const rows = sqlite.prepare(`SELECT section_id AS sectionId, question FROM studio_quiz WHERE lesson_id = ? AND section_id IN (${marks}) ORDER BY section_id, ordinal`)
    .all(row.id, ...done) as { sectionId: string; question: string }[];
  const recent = new Set(done.slice(-2));
  const size = Math.max(1, Math.min(50, Math.trunc(n) || 10));
  const near = shuffle(rows.filter((r) => recent.has(r.sectionId)), random);
  const far = shuffle(rows.filter((r) => !recent.has(r.sectionId)), random);
  const wantNear = Math.ceil(size / 2);
  const picked = [...near.slice(0, wantNear), ...far.slice(0, size - Math.min(wantNear, near.length))];
  if (picked.length < size) picked.push(...near.slice(wantNear, wantNear + size - picked.length));
  return picked.map((r) => {
    const q = JSON.parse(r.question) as QuizQuestion;
    const order = shuffle(q.options.map((_, i) => i), random);
    return { q: q.q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer), why: q.why, sectionId: r.sectionId, sectionTitle: titles.get(r.sectionId) ?? "" };
  });
}

/** File audio di una lezione: solo `.mp3` dentro la sua cartella `studio/`. Null se fuori o assente. */
export async function audioFile(id: number, rel: string): Promise<string | null> {
  const row = lessonRow(id);
  if (typeof rel !== "string" || !rel.toLowerCase().endsWith(".mp3") || rel.includes("\0") || path.isAbsolute(rel)) return null;
  const base = path.dirname(row.path);
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) return null;
  const real = await fs.realpath(full).catch(() => null);
  const realBase = await fs.realpath(base).catch(() => null);
  if (!real || !realBase || !real.startsWith(realBase + path.sep)) return null;
  return real;
}
