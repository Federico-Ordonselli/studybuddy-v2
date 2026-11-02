import { LibraryError } from "@/lib/errors";
import type { Chapter, CodeBlock, Lesson, QuizQuestion, Section, Segment, Study, Visual } from "@/lib/studioTypes";

/** Validazione di lesson.json e study.json, senza DB: la usano l'ingest e `prepare:full-studio`. */

type Obj = Record<string, unknown>;
const bad = (what: string): never => { throw new LibraryError(`Lezione Full Studio non valida: ${what}`); };
export const obj = (v: unknown, what: string): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : bad(what));
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

export const sectionIds = (lesson: Lesson) => lesson.chapters.flatMap((c) => c.sections.map((s) => s.id));

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

