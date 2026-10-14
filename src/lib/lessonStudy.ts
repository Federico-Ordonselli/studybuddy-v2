import { sqlite } from "@/lib/db";
import { resolveScope } from "@/lib/rag/store";
import { LibraryError } from "@/lib/errors";
import { positiveId, text } from "@/lib/validation";
import { generateGuide, lessonPassages, passageContext, SUMMARY_QUESTION, type GuideQuestion, type LessonPassage } from "@/lib/lessonPrompts";
import { gradeAnswer, type Grade } from "@/lib/tutor/grade";
import { generateQuiz, type QuizQuestion } from "@/lib/tutor/quiz";
import { createNote } from "@/lib/notes";
import { checkCard } from "@/lib/tutor/cardQuality";
import { markDuplicates } from "@/lib/tutor/cardGen";
import fs from "node:fs";
import { randomInt } from "node:crypto";
import type { CardDraft } from "@/lib/tutor/cardGen";
import type { CornellView, LessonView, PretestView } from "@/lib/lessonStudyTypes";

interface DocumentRow { id: number; title: string; courseId: number; course: string; source: string | null; kind: string; meta: string | null }
interface CornellState { guide: GuideQuestion[]; passages: LessonPassage[]; partial: boolean; answers: string[]; summary: string; grade: Grade | null }
interface PretestState { questions: QuizQuestion[]; partial: boolean }
interface WorkRow { state: string; revision: number; note_id: number | null }
const working = new Set<string>();
// Una nuova generazione non riparte da 1: schede e bozze precedenti al re-ingest
// devono restare obsolete anche se il documento mantiene lo stesso id.
const initialRevision = () => randomInt(1, 2 ** 48 - 1);

function scope(domainId: number) {
  positiveId(domainId, "domainId", true);
  if (!sqlite.prepare("SELECT 1 FROM domains WHERE id = ?").get(domainId)) throw new LibraryError("Corso non trovato", 404);
  return resolveScope(domainId)!;
}
function metaOf(row: DocumentRow): Record<string, unknown> {
  try { return JSON.parse(row.meta ?? "{}") ?? {}; } catch { return {}; }
}
function lessonView(row: DocumentRow): LessonView {
  const meta = metaOf(row);
  const fallback = row.source?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? `Documento ${row.id}`;
  return { id: row.id, courseId: row.courseId, course: row.course,
    title: typeof meta.lesson === "string" ? meta.lesson : row.title || fallback,
    module: typeof meta.module === "string" ? meta.module : "",
    video: row.kind === "transcript" && row.source && /\.(?:en\.)?(?:srt|vtt)$/i.test(row.source) &&
      fs.existsSync(row.source.replace(/\.(?:en\.)?(?:srt|vtt)$/i, ".mp4"))
      ? row.source.replace(/\.(?:en\.)?(?:srt|vtt)$/i, ".mp4") : null };
}
function document(domainId: number, documentId: number): DocumentRow {
  positiveId(documentId, "documentId", true);
  const ids = scope(domainId);
  const row = sqlite.prepare(`SELECT d.id, d.title, d.domain_id AS courseId, n.name AS course, d.source, d.kind, d.meta
    FROM documents d JOIN domains n ON n.id = d.domain_id WHERE d.id = ? AND d.domain_id IN (${ids.map(() => "?").join(",")})`)
    .get(documentId, ...ids) as DocumentRow | undefined;
  if (!row) throw new LibraryError("Lezione non trovata nel corso selezionato", 404);
  return row;
}
export function listLessons(domainId: number): LessonView[] {
  const ids = scope(domainId);
  return (sqlite.prepare(`SELECT d.id, d.title, d.domain_id AS courseId, n.name AS course, d.source, d.kind, d.meta
    FROM documents d JOIN domains n ON n.id = d.domain_id
    WHERE d.domain_id IN (${ids.map(() => "?").join(",")}) AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND length(trim(c.content)) > 0)
    ORDER BY n.name, d.source, d.id`).all(...ids) as DocumentRow[]).map(lessonView);
}
export function readLesson(domainId: number, documentId: number) {
  const doc = document(domainId, documentId);
  const chunks = sqlite.prepare("SELECT content FROM chunks WHERE document_id = ? ORDER BY ordinal, id").all(documentId) as { content: string }[];
  const full = chunks.map((c) => c.content).join("\n\n");
  return { title: lessonView(doc).title, text: full.slice(0, 100000), partial: full.length > 100000 };
}
function material(documentId: number) {
  const chunks = sqlite.prepare("SELECT id AS chunkId, content FROM chunks WHERE document_id = ? ORDER BY ordinal, id").all(documentId) as LessonPassage[];
  const result = lessonPassages(chunks);
  if (!result.passages.length) throw new LibraryError("La lezione non contiene materiale testuale");
  return result;
}
function unchangedMaterial(documentId: number, passages: LessonPassage[]) {
  const fresh = material(documentId).passages;
  if (JSON.stringify(fresh) !== JSON.stringify(passages)) throw new LibraryError("Il materiale della lezione è cambiato. Riprova con la versione aggiornata.", 409);
}
function row(documentId: number, kind: string): WorkRow | undefined {
  return sqlite.prepare("SELECT state, revision, note_id FROM lesson_studies WHERE document_id = ? AND kind = ?").get(documentId, kind) as WorkRow | undefined;
}
function cornellView(documentId: number, r: WorkRow): CornellView {
  const s = JSON.parse(r.state) as CornellState;
  return { documentId, revision: r.revision, questions: s.guide.map((q) => q.question), answers: s.answers,
    summary: s.summary, grade: s.grade, noteId: r.note_id, partial: s.partial };
}
export function getCornell(domainId: number, documentId: number): CornellView | null {
  document(domainId, documentId);
  const r = row(documentId, "cornell");
  return r ? cornellView(documentId, r) : null;
}
async function exclusive<T>(documentId: number, kind: string, fn: () => Promise<T>): Promise<T> {
  const key = `${documentId}:${kind}`;
  if (working.has(key)) throw new LibraryError("Operazione già in corso per questa lezione", 409);
  working.add(key);
  try { return await fn(); } finally { working.delete(key); }
}
export async function startCornell(domainId: number, documentId: number): Promise<CornellView> {
  document(domainId, documentId);
  return exclusive(documentId, "cornell", async () => {
    const existing = row(documentId, "cornell");
    if (existing) return cornellView(documentId, existing);
    const { passages, partial } = material(documentId);
    const guide = await generateGuide(passages);
    document(domainId, documentId); // la lezione può essere stata eliminata durante la generazione
    unchangedMaterial(documentId, passages);
    const state: CornellState = { guide, passages, partial, answers: guide.map(() => ""), summary: "", grade: null };
    sqlite.prepare("INSERT OR IGNORE INTO lesson_studies (document_id, kind, state, revision) VALUES (?, 'cornell', ?, ?)").run(documentId, JSON.stringify(state), initialRevision());
    return cornellView(documentId, row(documentId, "cornell")!);
  });
}
function current(domainId: number, documentId: number, revision: unknown, kind = "cornell") {
  const doc = document(domainId, documentId);
  positiveId(revision, "revision", true);
  const r = row(documentId, kind);
  if (!r) throw new LibraryError("Avvia prima l'attività", 404);
  if (r.revision !== revision) throw new LibraryError("L'attività è cambiata in un'altra scheda. Ricarica prima di salvare.", 409);
  return { doc, r };
}
function draft(s: CornellState, answers: unknown, summary: unknown): CornellState {
  if (!Array.isArray(answers) || answers.length !== s.guide.length || answers.some((a) => typeof a !== "string" || a.length > 900))
    throw new LibraryError("Inserisci un appunto di massimo 900 caratteri per ogni domanda");
  if (typeof summary !== "string" || summary.length > 2000) throw new LibraryError("Riassunto non valido (max 2000 caratteri)");
  const changed = summary !== s.summary || answers.some((a, i) => a !== s.answers[i]);
  return { ...s, answers, summary, grade: changed ? null : s.grade };
}
function noteContent(doc: DocumentRow, s: CornellState) {
  const parts = [`Appunti Cornell — ${lessonView(doc).title}`, ...s.guide.map((q, i) => `${i + 1}. ${q.question}\n${s.answers[i].trim() || '(Da completare)'}`),
    `Riassunto\n${s.summary.trim() || '(Da completare)'}`];
  if (s.grade) parts.push(`Verifica\n${s.grade.feedback}`, `Punti coperti: ${s.grade.present.join('; ') || '—'}`,
    `Punti mancanti: ${s.grade.missing.join('; ') || '—'}`, `Errori: ${s.grade.errors.join('; ') || '—'}`);
  return parts.join("\n\n");
}
/** Nota e stato nella stessa transazione; revisione ottimistica contro salvataggi concorrenti. */
function persist(doc: DocumentRow, previous: WorkRow, state: CornellState): CornellView {
  return sqlite.transaction(() => {
    const actual = row(doc.id, "cornell");
    if (!actual || actual.revision !== previous.revision) throw new LibraryError("Appunti modificati in un'altra scheda. Ricarica prima di salvare.", 409);
    const content = noteContent(doc, state);
    text(content, "nota");
    let noteId = actual.note_id;
    if (noteId === null) noteId = createNote({ content, courseId: doc.courseId }).id;
    else sqlite.prepare("UPDATE notes SET content = ? WHERE id = ?").run(content, noteId);
    sqlite.prepare("UPDATE lesson_studies SET state = ?, revision = revision + 1, note_id = ? WHERE document_id = ? AND kind = 'cornell'")
      .run(JSON.stringify(state), noteId, doc.id);
    return cornellView(doc.id, row(doc.id, "cornell")!);
  }).immediate();
}
export function saveCornell(domainId: number, documentId: number, revision: unknown, answers: unknown, summary: unknown) {
  const { doc, r } = current(domainId, documentId, revision);
  return persist(doc, r, draft(JSON.parse(r.state), answers, summary));
}
export async function checkCornell(domainId: number, documentId: number, revision: unknown, answers: unknown, summary: unknown) {
  const { doc, r } = current(domainId, documentId, revision);
  const s = draft(JSON.parse(r.state), answers, summary);
  text(s.summary, "riassunto", 2000);
  return exclusive(documentId, "cornell", async () => {
    const expected = s.guide.map((q) => `${q.question}\n${q.answer}`).join("\n\n");
    const grade = await gradeAnswer(SUMMARY_QUESTION, expected, s.summary, passageContext(s.passages));
    return persist(doc, r, { ...s, grade });
  });
}
export function cornellCard(domainId: number, documentId: number, revision: unknown, index: unknown): CardDraft {
  const { r } = current(domainId, documentId, revision);
  const s = JSON.parse(r.state) as CornellState;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= s.guide.length) throw new LibraryError("Domanda non valida");
  if (!s.answers[index].trim()) throw new LibraryError("Scrivi e salva un appunto prima di creare la carta");
  const q = s.guide[index];
  const card = { question: q.question, answer: q.answer, type: "qa" as const, fact: "", sourceChunkId: s.passages[q.source - 1]?.chunkId ?? null };
  const ids = resolveScope(domainId)!;
  const existing = (sqlite.prepare(`SELECT question FROM cards WHERE domain_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { question: string }[]).map((r) => r.question);
  return markDuplicates([{ ...card, issues: checkCard(card) }], existing)[0];
}
/** Pretesting: nessun giudice, nessuna carta, nessun log FSRS; le attese restano sul server fino al tentativo. */
export async function startPretest(domainId: number, documentId: number): Promise<PretestView> {
  document(domainId, documentId);
  return exclusive(documentId, "pretest", async () => {
    const existing = row(documentId, "pretest");
    if (existing) {
      const s = JSON.parse(existing.state) as PretestState;
      return { questions: s.questions.map((q) => q.question), partial: s.partial, revision: existing.revision };
    }
    const { passages, partial } = material(documentId);
    const questions = await generateQuiz(passageContext(passages), 3, { kind: "open", focus: "concepts" });
    if (questions.length !== 3 || new Set(questions.map((q) => q.question.trim().toLowerCase())).size !== 3 ||
      questions.some((q) => q.question.length > 500 || q.answer.length > 1500 || typeof q.rationale !== "string" || q.rationale.length > 2000))
      throw new Error("Non è stato possibile creare tre domande valide. Riprova o scegli un'altra lezione.");
    document(domainId, documentId);
    unchangedMaterial(documentId, passages);
    sqlite.prepare("INSERT OR IGNORE INTO lesson_studies (document_id, kind, state, revision) VALUES (?, 'pretest', ?, ?)")
      .run(documentId, JSON.stringify({ questions, partial }), initialRevision());
    const r = row(documentId, "pretest")!;
    const s = JSON.parse(r.state) as PretestState;
    return { questions: s.questions.map((q) => q.question), partial: s.partial, revision: r.revision };
  });
}
export function revealPretest(domainId: number, documentId: number, revision: unknown, answers: unknown) {
  const { r } = current(domainId, documentId, revision, "pretest");
  const s = JSON.parse(r.state) as PretestState;
  if (!Array.isArray(answers) || answers.length !== 3) throw new LibraryError("Prova a rispondere alle tre domande (puoi scrivere «non so»)");
  answers.forEach((a) => text(a, "risposta", 2000));
  return { references: s.questions.map((q) => ({ answer: q.answer, rationale: q.rationale })) };
}
