# Fase 2 — Giudice a verdetti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il giudice delle risposte dà un verdetto `wrong | partial | correct` (dopo aver detto cosa chiede la domanda), con il passaggio sorgente davanti; il rating FSRS lo calcola il codice e la UI mostra verdetto, mancanze, errori e link al passaggio.

**Architecture:** `grade.ts` cambia schema/prompt/tipo (`Grade` con `verdict`); `scheduler.toRating` sostituisce `ratingFromQuality`; un modulo nuovo `gradingSource.ts` dà al giudice il chunk sorgente (o il primo risultato di `retrieve`) e la sua `Citation`; ripasso e quiz passano la sorgente al giudice e la restituiscono alla UI, dove `VerdictPanel` + `CitationChip` + `VideoPanel` (estratti da `TutorView`) la mostrano.

**Tech Stack:** Next 16, React 19, TypeScript 7, better-sqlite3/drizzle, ts-fsrs 5.4.2, Ollama (structured output), `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-12-fase2-giudice-design.md`

## Global Constraints

- `PROMPT_VERSION = "grade-v2"` in `src/lib/tutor/grade.ts`.
- Giudice: temperatura 0, un retry, `throw` se l'output non è valido (mai un verdetto finto).
- Mappa: wrong → `Rating.Again` (1), partial → `Rating.Hard` (2), correct → `Rating.Good` (3). Easy solo da correzione manuale.
- `legacy_quality` non si scrive più (la colonna resta); `grader_rationale` = JSON `{ required, present, missing, errors, feedback }`.
- Sorgente: chunk tagliato a **1500** caratteri; fallback `retrieve(question, domainId)`; un errore del retrieve non blocca il giudizio.
- App generica: nessun prompt o default pensato per un corso.
- Colori solo in `src/app/tokens.css` come token semantici + `@check`; `npm run colors:check` exit 0. Stati sempre con testo/icona.
- `npm test` senza Ollama; `npm run typecheck` pulito; non toccare il DB reale (`data/studybuddy.db`): build e dev con `DB_PATH` temporaneo.
- Commit in italiano, `git add` con file espliciti, niente push.

## Review Focus

- Risposta vuota o «non so» → `wrong` (lo dice il prompt; il test verifica che la risposta vuota arrivi al giudice delimitata, non saltata). → Task 1, test `gradeAnswer: risposta vuota`.
- Carta il cui `source_chunk_id` punta a un chunk cancellato (re-ingest lo mette a NULL, ma un id orfano non deve rompere) → fallback su retrieve. → Task 2, test `id inesistente`.
- Ollama giù solo per l'embedding (retrieve fallisce) mentre la chat risponde → si giudica senza sorgente, nessun errore. → Task 2, test `retrieve fallisce`.
- Modello che dice `correct` ma elenca `errors` → la carta non va a Good. → Task 1, test di declassamento + Task 2 `reviewCard` con giudizio incoerente.
- Domanda mcq nel quiz → nessuna chiamata al giudice, verdetto `correct`/`wrong`, nessuna sorgente richiesta. → Task 2, test `gradeTurn mcq non chiama il modello`.

---

## File Structure

| File | Ruolo |
|---|---|
| `src/lib/tutor/grade.ts` (modifica) | schema, prompt, `Grade`, `Verdict`, `parseGrade`, `gradeAnswer(…, source?)` |
| `src/lib/tutor/scheduler.ts` (modifica) | `toRating(verdict)`; via `ratingFromQuality` |
| `src/lib/rag/store.ts` (modifica) | `getChunk(id): Retrieved \| null` |
| `src/lib/tutor/gradingSource.ts` (nuovo) | `gradingSource(question, sourceChunkId, domainId)` → `{ text, citation } \| null` |
| `src/lib/tutor/cards.ts` (modifica) | `reviewCard` usa sorgente + verdetto; `ReviewResult.source` |
| `src/lib/tutor/session.ts` (modifica) | `gradeChoice` a verdetti; `gradeTurn(q, answer, domainId)` con sorgente |
| `src/app/api/chat/route.ts` (modifica) | passa `domainId` a `gradeTurn` |
| `src/lib/evals/grading.ts`, `scripts/eval.ts` (modifica) | verdetto diretto, `source` al giudice |
| `src/app/tokens.css` (modifica) | `--warning-soft`, `--on-warning-soft` + `@check` |
| `src/components/study/CitationChip.tsx`, `VideoPanel.tsx`, `VerdictPanel.tsx` (nuovi) | UI condivisa |
| `src/components/study/types.ts`, `styles.ts`, `ReviewView.tsx`, `TutorView.tsx` (modifica) | tipi e viste |
| `tests/helpers/judge.ts` (nuovo) | Ollama finto condiviso dai test |
| `tests/grade.test.ts`, `tests/grading-source.test.ts` (nuovi); `tests/review-logs.test.ts`, `tests/fsrs.test.ts`, `tests/study-core.test.ts`, `tests/eval-grading.test.ts` (modifica) | test |
| `evals/README.md`, `CLAUDE.md` (modifica) | documentazione |

Nota sulla spec: `gradingSource` sta in un file suo (`tutor/gradingSource.ts`) invece che in `cards.ts`, perché lo usano sia `cards.ts` sia `session.ts`. Della coppia `--warning`/`--warning-soft` della spec serve solo la versione soft (pillola): `--warning` testo semplice non avrebbe usi (YAGNI).

---

### Task 1: Il giudice a verdetti (backend, senza sorgente)

**Files:**
- Create: `tests/helpers/judge.ts`, `tests/grade.test.ts`
- Modify: `src/lib/tutor/grade.ts` (tutto), `src/lib/tutor/scheduler.ts:121-124`, `src/lib/tutor/cards.ts:9-11,86-110`, `src/lib/tutor/session.ts:51-70`, `src/lib/evals/grading.ts:1,60-68`, `scripts/eval.ts:12-14,39-50`
- Test: `tests/grade.test.ts`, `tests/review-logs.test.ts`, `tests/fsrs.test.ts`, `tests/study-core.test.ts`, `tests/eval-grading.test.ts`

**Interfaces:**
- Produces:
  - `grade.ts`: `export const VERDICTS = ["wrong","partial","correct"] as const; export type Verdict = (typeof VERDICTS)[number];` `export interface Grade { verdict: Verdict; required: string[]; present: string[]; missing: string[]; errors: string[]; feedback: string }` `export function parseGrade(raw: string): Grade | null` `export async function gradeAnswer(question: string, expected: string, studentAnswer: string, source?: string): Promise<Grade>` `export function rationaleJson(g: Grade): string`
  - `scheduler.ts`: `export function toRating(verdict: Verdict): Grade` (Grade = rating FSRS 1–4 di ts-fsrs, come oggi)
  - `tests/helpers/judge.ts`: `withJudge(replies, fn, bodies?)`, `verdictJson(verdict, extra?)`
  - `evals/grading.ts` re-esporta `VERDICTS`/`Verdict` da `grade.ts` (stessi nomi di oggi)

- [ ] **Step 1: Helper dei test** — crea `tests/helpers/judge.ts`:

```ts
import type { Verdict } from "@/lib/tutor/grade";

/**
 * Ollama finto. `/api/chat` restituisce `replies` in ordine (l'ultima si ripete); ogni altra
 * chiamata (es. `/api/embed` del retrieve) risponde 503, come un Ollama senza modello di embedding.
 * I corpi delle chiamate chat finiscono in `bodies`.
 */
export async function withJudge<T>(replies: string[], fn: () => Promise<T>, bodies: Record<string, unknown>[] = []): Promise<T> {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/api/chat")) return new Response("offline", { status: 503 });
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ message: { content: replies[Math.min(i++, replies.length - 1)] } });
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

/** Giudizio ben formato con il verdetto dato; `extra` sovrascrive i campi. */
export const verdictJson = (verdict: Verdict, extra: Record<string, unknown> = {}) => JSON.stringify({
  required: ["l'idea centrale"], present: verdict === "wrong" ? [] : ["l'idea centrale"],
  missing: [], errors: [], verdict, feedback: "ok", ...extra,
});
```

- [ ] **Step 2: Test del giudice (fallisce)** — crea `tests/grade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer, parseGrade, rationaleJson, PROMPT_VERSION } from "@/lib/tutor/grade";
import { Rating, toRating } from "@/lib/tutor/scheduler";
import { verdictJson, withJudge } from "./helpers/judge";

test("PROMPT_VERSION è grade-v2", () => assert.equal(PROMPT_VERSION, "grade-v2"));

test("parseGrade: accetta un giudizio completo", () => {
  const g = parseGrade(verdictJson("partial", { missing: ["il perché"], feedback: "Manca il perché." }));
  assert.deepEqual(g, { verdict: "partial", required: ["l'idea centrale"], present: ["l'idea centrale"], missing: ["il perché"], errors: [], feedback: "Manca il perché." });
});

test("parseGrade: rifiuta output malformati", () => {
  for (const raw of [
    "non è JSON",
    JSON.stringify({ quality: 4, correct: true, feedback: "vecchio formato" }),
    verdictJson("forse" as never),
    verdictJson("correct", { missing: "una stringa" }),
    verdictJson("correct", { errors: [1, 2] }),
    verdictJson("wrong", { feedback: 3 }),
  ]) assert.equal(parseGrade(raw), null, raw);
});

test("parseGrade: correct con mancanze o errori viene declassato a partial", () => {
  assert.equal(parseGrade(verdictJson("correct", { errors: ["dice che blocca dopo"] }))?.verdict, "partial");
  assert.equal(parseGrade(verdictJson("correct", { missing: ["il flag -p"] }))?.verdict, "partial");
  assert.equal(parseGrade(verdictJson("correct"))?.verdict, "correct");
  assert.equal(parseGrade(verdictJson("wrong", { errors: ["x"] }))?.verdict, "wrong");
});

test("toRating: wrong → Again, partial → Hard, correct → Good", () => {
  assert.deepEqual((["wrong", "partial", "correct"] as const).map(toRating), [Rating.Again, Rating.Hard, Rating.Good]);
});

test("rationaleJson: giudizio senza verdetto, per review_logs", () => {
  const g = parseGrade(verdictJson("partial", { missing: ["m"], errors: ["e"] }))!;
  assert.deepEqual(JSON.parse(rationaleJson(g)), { required: g.required, present: g.present, missing: ["m"], errors: ["e"], feedback: "ok" });
});

test("gradeAnswer: un retry, poi errore invece di un verdetto finto", async () => {
  const bodies: Record<string, unknown>[] = [];
  const g = await withJudge(["non è JSON", verdictJson("correct")], () => gradeAnswer("D?", "R", "r"), bodies);
  assert.equal(g.verdict, "correct");
  assert.equal(bodies.length, 2);
  await assert.rejects(withJudge(["no", "no"], () => gradeAnswer("D?", "R", "r")), /valutazione valida/);
});

test("gradeAnswer: temperatura 0, schema con il verdetto dopo il ragionamento, sorgente nel messaggio", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withJudge([verdictJson("wrong")], () => gradeAnswer("Cos'è HEAD?", "Il commit corrente", "", "HEAD punta al commit corrente."), bodies);
  const body = bodies[0] as { options: { temperature: number }; format: { properties: Record<string, unknown> }; messages: { role: string; content: string }[] };
  assert.equal(body.options.temperature, 0);
  assert.deepEqual(Object.keys(body.format.properties), ["required", "present", "missing", "errors", "verdict", "feedback"]);
  const user = body.messages.at(-1)!.content;
  assert.match(user, /Passaggio sorgente:\n"""\nHEAD punta al commit corrente\.\n"""/);
  assert.match(user, /Risposta dello studente:\n"""\n\n"""/); // risposta vuota: arriva al giudice, delimitata
});

test("gradeAnswer: senza sorgente il messaggio non ha la sezione", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withJudge([verdictJson("correct")], () => gradeAnswer("D?", "R", "r"), bodies);
  const user = (bodies[0] as { messages: { content: string }[] }).messages.at(-1)!.content;
  assert.doesNotMatch(user, /Passaggio sorgente/);
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `npx tsx --test tests/grade.test.ts`
Expected: FAIL (`parseGrade`/`toRating`/`rationaleJson` non esportati). Verifica prima in `src/lib/providers/ollama.ts` che il corpo della chat porti `options.temperature` e `format`: se i nomi differiscono, adatta le asserzioni del test, non il provider.

- [ ] **Step 4: Nuovo `grade.ts`** — sostituisci tutto il file con:

```ts
import { generate } from "@/lib/providers";

/** Versione del prompt del giudice: finisce in review_logs e nei risultati di `npm run eval`. */
export const PROMPT_VERSION = "grade-v2";

export const VERDICTS = ["wrong", "partial", "correct"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Giudizio su una risposta: cosa chiede la domanda, cosa c'è, cosa manca, cosa è falso, verdetto. */
export interface Grade {
  verdict: Verdict;
  required: string[]; // ciò che la domanda chiede
  present: string[];
  missing: string[];
  errors: string[];   // affermazioni false nella risposta
  feedback: string;   // per lo studente
}

const list = { type: "array", items: { type: "string" } } as const;
/** Ordine delle proprietà = ordine di generazione di Ollama: il verdetto arriva dopo il ragionamento. */
const SCHEMA = {
  type: "object",
  properties: {
    required: list,
    present: list,
    missing: list,
    errors: list,
    verdict: { type: "string", enum: VERDICTS },
    feedback: { type: "string" },
  },
  required: ["required", "present", "missing", "errors", "verdict", "feedback"],
} as const;

const SYSTEM = [
  "Sei un valutatore di risposte di studio. Si valuta ciò che la DOMANDA chiede, non tutto ciò che contiene la risposta attesa.",
  "Procedi in quest'ordine:",
  "1. required: gli elementi che la domanda chiede (da 1 a 4, brevi). Usa la risposta attesa e il passaggio sorgente solo per sapere qual è il contenuto giusto di quegli elementi: un dettaglio dell'attesa che la domanda non chiede NON è richiesto.",
  "2. present: gli elementi di required che la risposta dello studente contiene, anche con parole diverse o in un'altra lingua.",
  "3. missing: gli elementi di required assenti dalla risposta.",
  "4. errors: le affermazioni false della risposta, comprese le aggiunte sbagliate attribuite a ciò che è chiesto. Una risposta più lunga non vale di più.",
  "5. verdict:",
  "- correct: risponde a ciò che è chiesto, anche con parole diverse o in un'altra lingua; un dettaglio secondario omesso non impedisce correct.",
  "- partial: manca, o è sbagliato, un elemento richiesto (anche un'aggiunta falsa su ciò che è chiesto). Negli elenchi e negli abbinamenti una parte giusta vale partial.",
  "- wrong: sbaglia la proprietà centrale di ciò che è chiesto, oppure è vuota o «non so».",
  "6. feedback: 2-3 frasi in italiano per lo studente: cosa manca o è sbagliato e perché conta; se è corretta, cosa ha colto.",
  "Se la risposta attesa e il passaggio sorgente non coincidono, vale il passaggio sorgente.",
].join("\n");

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Accetta solo un giudizio ben formato. Un `correct` con mancanze o errori elencati è incoerente:
 * vale `partial` (rete contro le risposte lunghe e sbagliate promosse a corrette).
 */
export function parseGrade(raw: string): Grade | null {
  try {
    const g = JSON.parse(raw);
    if (!(VERDICTS as readonly unknown[]).includes(g?.verdict) || typeof g.feedback !== "string") return null;
    if (![g.required, g.present, g.missing, g.errors].every(strings)) return null;
    const verdict: Verdict = g.verdict === "correct" && (g.missing.length || g.errors.length) ? "partial" : g.verdict;
    return { verdict, required: g.required, present: g.present, missing: g.missing, errors: g.errors, feedback: g.feedback };
  } catch {
    return null;
  }
}

/** Il giudizio per `review_logs.grader_rationale` (il verdetto è già nel rating). */
export function rationaleJson({ required, present, missing, errors, feedback }: Grade): string {
  return JSON.stringify({ required, present, missing, errors, feedback });
}

const block = (label: string, text: string) => `${label}:\n"""\n${text}\n"""`;

/**
 * LLM-as-judge: verdetto sulla risposta libera, con il passaggio sorgente (se c'è) come riferimento.
 * Se il modello non produce un giudizio valido (dopo un retry) lancia un errore invece di
 * inventare un verdetto: un `wrong` finto rischedulerebbe la carta come dimenticata.
 */
export async function gradeAnswer(question: string, expected: string, studentAnswer: string, source?: string): Promise<Grade> {
  const content = [
    `Domanda: ${question}`,
    `Risposta attesa: ${expected}`,
    ...(source?.trim() ? [block("Passaggio sorgente", source.trim())] : []),
    block("Risposta dello studente", studentAnswer.trim()),
    "Valuta (JSON).",
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate("grade", {
      system: SYSTEM,
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
      messages: [{ role: "user", content }],
    });
    const grade = parseGrade(raw);
    if (grade) return grade;
  }
  throw new Error("Il modello non ha prodotto una valutazione valida: la carta non è stata riprogrammata. Riprova.");
}
```

- [ ] **Step 5: `toRating` in `scheduler.ts`** — sostituisci `ratingFromQuality` (righe 121-124) con:

```ts
/** Verdetto del giudice → rating. Easy non viene dal giudice: lo deciderà la fiducia (Fase 6). */
export function toRating(verdict: Verdict): Grade {
  return verdict === "correct" ? Rating.Good : verdict === "partial" ? Rating.Hard : Rating.Again;
}
```
e in testa al file `import type { Verdict } from "./grade";`.

- [ ] **Step 6: `reviewCard` a verdetti (sorgente nel Task 2)** — in `src/lib/tutor/cards.ts`: import da `./grade` diventa `import { gradeAnswer, PROMPT_VERSION, rationaleJson, type Grade } from "./grade";`; in quello da `./scheduler` sostituisci `ratingFromQuality` con `toRating`. Nel corpo di `reviewCard`:

```ts
  const grade = await gradeAnswer(card.question, card.answer, answer);
  const rating = toRating(grade.verdict);
```
e nell'insert del log togli `legacyQuality: grade.quality,` e metti `graderRationale: rationaleJson(grade),`.

- [ ] **Step 7: `gradeChoice` a verdetti** — in `src/lib/tutor/session.ts` sostituisci `gradeChoice` e il suo commento con:

```ts
/**
 * Le mcq hanno una sola risposta giusta: confronto esatto, niente LLM-as-judge
 * (che premiava opzioni sbagliate ma "concettualmente vicine"). Mai partial.
 */
export function gradeChoice(q: QuizQuestion, chosen: string): Grade {
  const correct = normalizeOption(chosen) === normalizeOption(q.answer);
  const why = q.rationale?.trim() ? ` ${q.rationale.trim()}` : "";
  const empty = { required: [], present: [], missing: [], errors: [] };
  return correct
    ? { verdict: "correct", ...empty, feedback: `Corretto.${why}` }
    : { verdict: "wrong", ...empty, feedback: `Non è corretta. Risposta giusta: «${q.answer}».${why}` };
}
```

- [ ] **Step 8: Eval** — in `src/lib/evals/grading.ts`: sostituisci `import type { Grade } …` e le righe `export const VERDICTS …` / `export type Verdict …` con

```ts
import { VERDICTS, type Grade, type Verdict } from "@/lib/tutor/grade";
export { VERDICTS, type Verdict };
```
e `verdictFromGrade` con

```ts
/** Il giudice dà già il verdetto a 3 livelli (grade-v2). */
export function verdictFromGrade(g: Grade): Verdict {
  return g.verdict;
}
```
Aggiorna il commento di `source` in `GradingCase` a `// passaggio sorgente: lo riceve il giudice`. In `scripts/eval.ts`: la chiamata diventa `gradeAnswer(c.question, c.expected, c.answer, c.source)`; nel tipo di `rows` sostituisci `quality: number | null` con `missing: string[]; errors: string[]`; nella push di successo `missing: g.missing, errors: g.errors` al posto di `quality: g.quality`, in quella d'errore `missing: [], errors: []`; nel `console.log` togli ` (q${g.quality})` e, se `model !== c.verdict`, stampa sotto `    mancava: ${g.missing.join("; ") || "—"} · errori: ${g.errors.join("; ") || "—"}`.

- [ ] **Step 9: Aggiorna i test esistenti**
  - `tests/eval-grading.test.ts`: il primo test diventa

    ```ts
    test("grade-v2 → verdetto: lettura diretta", () => {
      for (const verdict of ["wrong", "partial", "correct"] as const)
        assert.equal(verdictFromGrade({ verdict, required: [], present: [], missing: [], errors: [], feedback: "" }), verdict);
    });
    ```
  - `tests/study-core.test.ts` righe 34-35:

    ```ts
     assert.equal(gradeChoice(q,' PRIMA  OPZIONE ').verdict,'correct');
     assert.equal(gradeChoice(q,'Seconda').verdict,'wrong');assert.deepEqual(gradeChoice(q,'Seconda').missing,[]);
    ```
  - `tests/review-logs.test.ts`: togli la `withJudge` locale e importa `import { verdictJson, withJudge } from "./helpers/judge";`. Primo test: `const judge = verdictJson("correct", { feedback: "Manca il dettaglio sul detached HEAD." });`; asserzioni `log.legacy_quality` → `null`, `log.rating` → `3` con commento `// correct → Good`, `JSON.parse(String(log.grader_rationale)).feedback` → `"Manca il dettaglio sul detached HEAD."`. Secondo test: `["non è JSON", JSON.stringify({ quality: 9 })]`. Terzo: `verdictJson("wrong", { feedback: "No." })`. Aggiungi:

    ```ts
    test("un correct con errori elencati non va a Good", async () => {
      sqlite.exec(`INSERT INTO cards (id, domain_id, question, answer, due_at) VALUES (3, 1, 'Cosa fa git add -p?', 'Aggiunge pezzi di modifiche in modo interattivo', 0);`);
      const result = await withJudge([verdictJson("correct", { errors: ["dice che fa il commit"] })], () => reviewCard(3, "aggiunge a pezzi e fa il commit", 1));
      assert.equal(result?.grade.verdict, "partial");
      assert.equal(logs(3)[0].rating, 2); // Hard
    });
    ```
  - `tests/fsrs.test.ts`: togli la `withJudge` locale e importa quella dell'helper; togli `ratingFromQuality` dall'import e il test «voto 0–5 → rating FSRS»; `judge(1)` diventa `verdictJson("wrong")` (togli la costante `judge`, importa `verdictJson`).

- [ ] **Step 10: Test e typecheck**

Run: `npx tsx --test tests/grade.test.ts tests/review-logs.test.ts tests/fsrs.test.ts tests/study-core.test.ts tests/eval-grading.test.ts && npm run typecheck`
Expected: PASS e typecheck pulito (la UI usa ancora `quality` in `components/study/types.ts`, un tipo suo: compila, si sistema nel Task 4).

- [ ] **Step 11: Commit**

```bash
git add tests/helpers/judge.ts tests/grade.test.ts src/lib/tutor/grade.ts src/lib/tutor/scheduler.ts src/lib/tutor/cards.ts src/lib/tutor/session.ts src/lib/evals/grading.ts scripts/eval.ts tests/review-logs.test.ts tests/fsrs.test.ts tests/study-core.test.ts tests/eval-grading.test.ts
git commit -m "Fase 2: giudice a verdetti (grade-v2) e rating calcolato dal codice"
```

---

### Task 2: Passaggio sorgente per il giudice

**Files:**
- Create: `src/lib/tutor/gradingSource.ts`, `tests/grading-source.test.ts`
- Modify: `src/lib/rag/store.ts` (dopo `ftsSearch`), `src/lib/tutor/cards.ts` (`ReviewResult`, `reviewCard`), `src/lib/tutor/session.ts` (`TutorTurn`, `gradeTurn`), `src/app/api/chat/route.ts:36`

**Interfaces:**
- Consumes: `gradeAnswer(question, expected, answer, source?)` (Task 1); `toCitations(chunks: Retrieved[]): Citation[]` e `retrieve(query, domainId?)` da `@/lib/rag/pipeline`.
- Produces:
  - `store.ts`: `export function getChunk(id: number): Retrieved | null`
  - `gradingSource.ts`: `export const SOURCE_CHARS = 1500;` `export interface GradingSource { text: string; citation: Citation }` `export async function gradingSource(question: string, sourceChunkId: number | null | undefined, domainId: number | null | undefined): Promise<GradingSource | null>`
  - `ReviewResult.source?: Citation`, `TutorTurn.source?: Citation`, `gradeTurn(q, studentAnswer, domainId?: number)`

- [ ] **Step 1: Test (fallisce)** — crea `tests/grading-source.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";
import { verdictJson, withJudge } from "./helpers/judge";

const { sqlite } = await useTempDb();
const { gradingSource, SOURCE_CHARS } = await import("@/lib/tutor/gradingSource");
const { reviewCard } = await import("@/lib/tutor/cards");
const { gradeTurn } = await import("@/lib/tutor/session");

const long = "HEAD punta al commit corrente. ".repeat(100);
sqlite.exec(`INSERT INTO domains (id, name) VALUES (1, 'Corso');
  INSERT INTO documents (id, domain_id, title, source, kind, meta) VALUES (1, 1, 'Lezione', '/corso/m1/lezione.en.srt', 'transcript', '{"crumbs":["Corso","Modulo 1"]}');
  INSERT INTO chunks (id, document_id, ordinal, content, meta) VALUES (7, 1, 0, '${long}', '{"startSec":125,"endSec":140}');
  INSERT INTO cards (id, domain_id, question, answer, source_chunk_id, due_at) VALUES (1, 1, 'Cos''è HEAD?', 'Il commit corrente', 7, 0),
    (2, 1, 'Cos''è git stash?', 'Mette da parte le modifiche', NULL, 0);`);

test("carta con sorgente: testo tagliato a 1500 caratteri e citazione del chunk", async () => {
  const s = await gradingSource("Cos'è HEAD?", 7, 1);
  assert.ok(s);
  assert.equal(s.text.length, SOURCE_CHARS);
  assert.equal(s.citation.documentId, 1);
  assert.equal(s.citation.kind, "transcript");
  assert.equal(s.citation.startSec, 125);
  assert.match(s.citation.label, /Corso › Modulo 1 › lezione\.en\.srt/);
});

test("id inesistente e retrieve che fallisce (embedding giù): nessuna sorgente, nessun errore", async () => {
  assert.equal(await withJudge([], () => gradingSource("Cos'è HEAD?", 999, 1)), null);
  assert.equal(await withJudge([], () => gradingSource("Cos'è git stash?", null, 1)), null);
});

test("reviewCard passa la sorgente al giudice e la restituisce", async () => {
  const bodies: Record<string, unknown>[] = [];
  const r = await withJudge([verdictJson("correct")], () => reviewCard(1, "il commit attuale", 1), bodies);
  assert.equal(r?.source?.documentId, 1);
  const user = (bodies[0] as { messages: { content: string }[] }).messages.at(-1)!.content;
  assert.match(user, /Passaggio sorgente/);
});

test("reviewCard senza sorgente trovabile giudica lo stesso", async () => {
  const r = await withJudge([verdictJson("wrong")], () => reviewCard(2, "non so", 1));
  assert.equal(r?.grade.verdict, "wrong");
  assert.equal(r?.source, undefined);
});

test("gradeTurn mcq non chiama il modello", async () => {
  const bodies: Record<string, unknown>[] = [];
  const q = { type: "mcq" as const, question: "Scegli", answer: "A", options: ["A", "B"], rationale: "" };
  const t = await withJudge([], () => gradeTurn(q, "B", 1), bodies);
  assert.equal(t.grade?.verdict, "wrong");
  assert.equal(bodies.length, 0);
});

test("gradeTurn aperta: giudizio con fallback retrieve (qui giù) e reply = feedback", async () => {
  const q = { type: "open" as const, question: "Cos'è HEAD?", answer: "Il commit corrente", rationale: "" };
  const t = await withJudge([verdictJson("partial", { feedback: "Quasi." })], () => gradeTurn(q, "un commit", 1));
  assert.equal(t.grade?.verdict, "partial");
  assert.equal(t.reply, "Quasi.");
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `npx tsx --test tests/grading-source.test.ts`
Expected: FAIL (modulo `@/lib/tutor/gradingSource` assente).

- [ ] **Step 3: `getChunk` in `store.ts`** — dopo `ftsSearch`:

```ts
/** Un chunk con i dati del documento, nello stesso formato dei risultati di ricerca (distance 0). */
export function getChunk(id: number): Retrieved | null {
  const r = sqlite
    .prepare(
      `SELECT c.id AS chunkId, 0 AS distance, c.content AS content, c.document_id AS documentId, c.meta AS meta,
              d.source AS source, d.kind AS docKind, d.meta AS docMeta
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ?`
    )
    .get(id) as Omit<VecRow, "domainId"> | undefined;
  if (!r) return null;
  return {
    chunkId: r.chunkId,
    documentId: r.documentId,
    content: r.content,
    distance: r.distance,
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    source: r.source,
    docKind: r.docKind,
    docMeta: r.docMeta ? JSON.parse(r.docMeta) : undefined,
  };
}
```

- [ ] **Step 4: `gradingSource.ts`**

```ts
import { retrieve, toCitations, type Citation } from "@/lib/rag/pipeline";
import { getChunk, type Retrieved } from "@/lib/rag/store";

/** Quanto del passaggio sorgente vede il giudice. */
export const SOURCE_CHARS = 1500;

export interface GradingSource {
  text: string;       // per il prompt del giudice
  citation: Citation; // per il link in UI (video al minuto se è una trascrizione)
}

/**
 * Il passaggio con cui giudicare una risposta: il chunk da cui è nata la carta, altrimenti
 * (carte da quiz, domande aperte del quiz) il primo risultato del retrieve sulla domanda.
 * Se il retrieve fallisce si giudica senza sorgente: non è un motivo per non valutare.
 */
export async function gradingSource(question: string, sourceChunkId: number | null | undefined, domainId: number | null | undefined): Promise<GradingSource | null> {
  let chunk: Retrieved | null | undefined = sourceChunkId ? getChunk(sourceChunkId) : null;
  if (!chunk) {
    try {
      [chunk] = await retrieve(question, domainId ?? undefined);
    } catch (e) {
      console.warn("[grade] sorgente non disponibile, giudizio senza passaggio:", e instanceof Error ? e.message : e);
    }
  }
  if (!chunk) return null;
  return { text: chunk.content.slice(0, SOURCE_CHARS), citation: toCitations([chunk])[0] };
}
```

- [ ] **Step 5: `reviewCard` con sorgente** — in `cards.ts`: `import { gradingSource } from "./gradingSource";` e `import type { Citation } from "@/lib/rag/pipeline";`; in `ReviewResult` aggiungi `source?: Citation; // passaggio usato dal giudice`; in `reviewCard`:

```ts
  const source = await gradingSource(card.question, card.sourceChunkId, card.domainId);
  const grade = await gradeAnswer(card.question, card.answer, answer, source?.text);
```
e nel `return` aggiungi `source: source?.citation`.

- [ ] **Step 6: `gradeTurn` con sorgente** — in `session.ts`: `import { gradingSource } from "./gradingSource";`; in `TutorTurn` aggiungi `source?: Citation; // passaggio usato dal giudice`; sostituisci `gradeTurn`:

```ts
/** Valuta la risposta a una domanda di quiz; le aperte col passaggio più pertinente come riferimento. */
export async function gradeTurn(q: QuizQuestion, studentAnswer: string, domainId?: number): Promise<TutorTurn> {
  if (q.type === "mcq" && q.options?.length) {
    const grade = gradeChoice(q, studentAnswer);
    return { reply: grade.feedback, grade };
  }
  const source = await gradingSource(q.question, null, domainId);
  const grade = await gradeAnswer(q.question, q.answer, studentAnswer, source?.text);
  return { reply: grade.feedback, grade, source: source?.citation };
}
```

- [ ] **Step 7: Route** — `src/app/api/chat/route.ts:36`: `gradeTurn(quizQuestion(body.question), text(body.answer, "answer"), domainId)`.

- [ ] **Step 8: Test e typecheck**

Run: `npx tsx --test tests/grading-source.test.ts tests/review-logs.test.ts tests/fsrs.test.ts && npm run typecheck`
Expected: PASS. Se `toCitations` cerca il video con `fs.existsSync` sul path finto, `video` resta `undefined`: atteso.

- [ ] **Step 9: Commit**

```bash
git add src/lib/rag/store.ts src/lib/tutor/gradingSource.ts src/lib/tutor/cards.ts src/lib/tutor/session.ts src/app/api/chat/route.ts tests/grading-source.test.ts
git commit -m "Fase 2: il giudice vede il passaggio sorgente e lo restituisce alla UI"
```

---

### Task 3: Token colore per «parziale»

**Files:**
- Modify: `src/app/tokens.css` (dopo `--on-danger-soft`, riga ~138; righe `@check` in fondo)

- [ ] **Step 1: Leggi** `color-boss/COLOR_BOSS.md` §1, §9, §10 e la testata di `tokens.css`.

- [ ] **Step 2: Aggiungi i token** dopo `--on-danger-soft`:

```css
  /* parziale (verdetto del giudice): ambra del brand, solo come pillola soft con testo + icona */
  --warning-soft:    light-dark(var(--brand-100), var(--brand-950));
  --on-warning-soft: light-dark(var(--brand-800), var(--brand-200));
```
e in fondo, dopo `@check --on-danger-soft on --danger-soft : text`:

```
   @check --on-warning-soft on --warning-soft : text
```

- [ ] **Step 3: Controllo**

Run: `npm run colors:check`
Expected: exit 0, 0 fail (restano i 3 warning motivati del danger dark). Se la nuova coppia fallisce: in light scurisci il testo (`--brand-900`), in dark schiariscilo (`--brand-100`), e ripeti.

- [ ] **Step 4: CVD delle tre pillole** — calcola gli hex dei fondi soft dalle primitive commentate in `tokens.css` (light: green-100 `#E5F0E7`, brand-100 `#F9EADC`, red-100 `#FEE7E1`; dark: green-950 `#142A1A`, brand-950 `#3A1A06`, red-950 `#470900`):

Run: `python3 color-boss/colorboss.py cvd "#E5F0E7" "#F9EADC" "#FEE7E1"` e `python3 color-boss/colorboss.py cvd "#142A1A" "#3A1A06" "#470900"`
Expected: un numero per tipo di CVD. Non blocca (lo stato ha sempre testo + icona), ma riporta i valori nel resoconto finale.

- [ ] **Step 5: Commit**

```bash
git add src/app/tokens.css
git commit -m "Token warning-soft per il verdetto parziale"
```

---

### Task 4: UI del verdetto (ripasso e quiz)

**Files:**
- Create: `src/components/study/CitationChip.tsx`, `src/components/study/VideoPanel.tsx`, `src/components/study/VerdictPanel.tsx`
- Modify: `src/components/study/types.ts`, `src/components/study/styles.ts`, `src/components/study/ReviewView.tsx`, `src/components/study/TutorView.tsx`

**Interfaces:**
- Consumes: risposta di `/api/review` (`ReviewResult` con `grade: Grade`, `source?: Citation`) e di `/api/chat` mode `review` (`{ reply, grade, source? }`) dai Task 1-2.
- Produces (client): `type Verdict`, `interface Grade`, `VERDICT_LABEL`, `interface PlayingVideo { path: string; startSec: number; label: string }` in `types.ts`; `<CitationChip c onPlay />`, `<VideoPanel video onClose />`, `<VerdictPanel grade expected? source? onPlay>{children}</VerdictPanel>`.

- [ ] **Step 1: Tipi** — in `types.ts` sostituisci `export interface Grade { quality… }` con:

```ts
export type Verdict = "wrong" | "partial" | "correct";
export interface Grade { verdict: Verdict; required: string[]; present: string[]; missing: string[]; errors: string[]; feedback: string }
/** Il verdetto ha sempre testo e icona, non solo colore. */
export const VERDICT_LABEL: Record<Verdict, string> = { correct: "✓ Corretta", partial: "◐ Parziale", wrong: "✗ Sbagliata" };
export interface PlayingVideo { path: string; startSec: number; label: string }
```
In `Msg` aggiungi `source?: Citation;`; in `ReviewResult` aggiungi `source?: Citation`.

- [ ] **Step 2: Stili** — in `styles.ts`: `citePlay` usa `color: "var(--success)"`; aggiungi

```ts
  verdict: { display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 13, fontWeight: 700 },
  verdictList: { margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5, fontSize: 14 },
```

- [ ] **Step 3: `CitationChip.tsx`** (dal markup di `TutorView` righe 160-169):

```tsx
import { S } from "./styles";
import { mmss, type Citation, type PlayingVideo } from "./types";

/** Pillola di una citazione; se il passaggio viene da una trascrizione apre il video al minuto. */
export default function CitationChip({ c, onPlay }: { c: Citation; onPlay: (v: PlayingVideo) => void }) {
  return (
    <button title={c.snippet}
      onClick={() => c.video && onPlay({ path: c.video.path, startSec: c.video.startSec, label: c.label })}
      style={{ ...S.cite, cursor: c.video ? "pointer" : "default" }}>
      <span style={S.citeN}>[{c.n}]</span>
      <span style={{ color: "var(--muted)" }}>{c.kind}</span>
      <span style={S.citeLabel}>{c.label}</span>
      {c.video && <span style={S.citePlay}>▶ {mmss(c.video.startSec)}</span>}
    </button>
  );
}
```

- [ ] **Step 4: `VideoPanel.tsx`** (da `TutorView` righe 117-127):

```tsx
import { S } from "./styles";
import { mmss, type PlayingVideo } from "./types";

/** Player del video sorgente, aperto al secondo della citazione. */
export default function VideoPanel({ video, onClose }: { video: PlayingVideo | null; onClose: () => void }) {
  if (!video) return null;
  return (
    <div style={S.player}>
      <div style={S.playerHead}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>▶ {video.label} · {mmss(video.startSec)}</span>
        <button onClick={onClose} style={S.x} aria-label="Chiudi il video">✕</button>
      </div>
      <video key={video.path + video.startSec}
        src={`/api/video?path=${encodeURIComponent(video.path)}#t=${video.startSec}`}
        controls autoPlay style={{ width: "100%", borderRadius: 8, background: "var(--bg)" }} />
    </div>
  );
}
```

- [ ] **Step 5: `VerdictPanel.tsx`**

```tsx
import type { ReactNode } from "react";
import CitationChip from "./CitationChip";
import { S } from "./styles";
import { VERDICT_LABEL, type Citation, type Grade, type PlayingVideo, type Verdict } from "./types";

const TONE: Record<Verdict, { background: string; color: string }> = {
  correct: { background: "var(--success-soft)", color: "var(--on-success-soft)" },
  partial: { background: "var(--warning-soft)", color: "var(--on-warning-soft)" },
  wrong: { background: "var(--danger-soft)", color: "var(--on-danger-soft)" },
};

function Items({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>{title}</div>
      <ul style={S.verdictList}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Esito del giudice: verdetto, feedback, cosa mancava, cosa correggere, risposta attesa e passaggio sorgente. */
export default function VerdictPanel({ grade, expected, source, onPlay, children }: {
  grade: Grade; expected?: string; source?: Citation; onPlay: (v: PlayingVideo) => void; children?: ReactNode;
}) {
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
        <span style={{ ...S.verdict, ...TONE[grade.verdict] }}>{VERDICT_LABEL[grade.verdict]}</span>
        {children}
      </div>
      <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{grade.feedback}</p>
      <Items title="Mancava" items={grade.missing} />
      <Items title="Da correggere" items={grade.errors} />
      {expected && <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>Risposta attesa: {expected}</div>}
      {source && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Passaggio di riferimento</div>
          <CitationChip c={source} onPlay={onPlay} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `ReviewView.tsx`** — import `VerdictPanel`, `VideoPanel`, tipo `PlayingVideo`; stato `const [video, setVideo] = useState<PlayingVideo | null>(null);` e in `loadDue` anche `setVideo(null)`. Subito dentro `<div style={S.review}>`, prima di `reviewBar`: `<VideoPanel video={video} onClose={() => setVideo(null)} />`. Sostituisci il blocco da `<div style={{ fontSize: 14 }}>Esito: …` fino al `{result.expected && (…)}` incluso con:

```tsx
              <VerdictPanel grade={result.grade} expected={result.expected} source={result.source} onPlay={setVideo}>
                <span>· <b>{RATING_LABEL[result.rating]}</b>{corrected && " (corretto da te)"}
                  <span style={{ color: "var(--muted)" }}> · prossimo ripasso {timeUntil(result.dueAt)}</span></span>
              </VerdictPanel>
```
Nelle righe `role="alert"` usa `var(--danger)` al posto di `var(--color-danger)`.

- [ ] **Step 7: `TutorView.tsx`**
  - import `CitationChip`, `VideoPanel`, `VerdictPanel`, `type PlayingVideo`; `useState<PlayingVideo | null>` per `video`; il tipo di ritorno di `chat()` aggiunge `source?: Citation`.
  - il blocco `{video && (<div style={S.player}>…</div>)}` diventa `<VideoPanel video={video} onClose={() => setVideo(null)} />`.
  - `submitAnswer`: il corpo diventa `{ mode: "review", domainId, question: q, answer: ans }` e il messaggio salva anche `source: turn.source`.
  - Nel thread, per i messaggi con `m.grade` non si mostra più `Markdown` del contenuto (sarebbe il feedback ripetuto): `{m.role === "user" ? … : m.grade ? null : <Markdown text={m.content} />}`; il blocco `Voto: …/5` diventa `<div style={{ marginTop: 4 }}><VerdictPanel grade={m.grade} source={m.source} onPlay={setVideo} /></div>`.
  - «Aggiungi al ripasso»: condizione `m.grade && m.grade.verdict !== "correct" && m.reviewQuiz`.
  - le citazioni: `{m.citations.map((c) => <CitationChip key={c.n} c={c} onPlay={setVideo} />)}`.
  - `cardError`: `var(--danger)` al posto di `var(--color-danger)`.

- [ ] **Step 8: Verifica statica**

Run: `npm run typecheck && npm test && npm run colors:check`
Expected: tutto verde. `grep -rn "quality\|color-ok\|color-danger" src/components/study` → nessun risultato.

- [ ] **Step 9: Commit**

```bash
git add src/components/study/CitationChip.tsx src/components/study/VideoPanel.tsx src/components/study/VerdictPanel.tsx src/components/study/types.ts src/components/study/styles.ts src/components/study/ReviewView.tsx src/components/study/TutorView.tsx
git commit -m "Fase 2: verdetto, mancanze e passaggio sorgente nel ripasso e nel quiz"
```

---

### Task 5: Eval, verifica nell'app e documentazione

**Files:**
- Modify: `evals/README.md` (ultima riga del criterio), `CLAUDE.md` (nota Grading / Eval / Review log)
- Possibile: `src/lib/tutor/grade.ts` (solo il testo di `SYSTEM`) se l'eval non passa

- [ ] **Step 1: Eval** (Ollama vero, ~52 chiamate)

Run: `npm run eval -- grading`
Expected: accordo esatto ≥ 80% e `"sbagliata ma lunga" promosse a correct: 0`. Confronta con `evals/results/2026-10-12-grading-grade-v1.json` (88.5% esatto, 58% borderline).

- [ ] **Step 2: Se non passa** — mostra all'utente la matrice e i casi `≠` (con `mancava`/`errori`) **prima** di cambiare la rubrica; si itera solo sul testo di `SYSTEM`, rigirando l'eval dopo ogni modifica. Se il giudice fallisce con JSON troncato (`errori` nel conteggio), il limite è `num_predict` 1024 del provider: passa `maxTokens: 2048` nella chiamata di `gradeAnswer`. Se il declassamento `correct → partial` produce la maggior parte degli errori su casi umani `correct`, proponi all'utente di toglierlo (la spec lo prevede). Commit di ogni versione del prompt che migliora: `git add src/lib/tutor/grade.ts && git commit -m "Prompt del giudice: <cosa cambia>"`.

- [ ] **Step 3: Verifica nell'app con DB temporaneo** (mai `data/studybuddy.db`)

```bash
SB=/tmp/claude-1000/sb-fase2 && mkdir -p $SB && cp data/studybuddy.db $SB/ui.db
DB_PATH=$SB/ui.db npm run dev
```
Con Playwright: apri `/study/<id corso con carte>?mode=review`, rispondi a una carta in modo parziale → pillola «◐ Parziale», «Mancava», passaggio di riferimento (se è trascrizione, «▶ m:ss» apre il video); «Il voto è sbagliato» funziona ancora. Poi `?mode=quiz`: una domanda aperta → `VerdictPanel` senza testo ripetuto; risposta sbagliata → «Aggiungi al ripasso». Screenshot in tema chiaro e scuro (`data-theme`). Chiudi il server e cancella `$SB`. Chiedi all'utente l'ok prima di copiare il DB reale se servono dati veri; in alternativa crea a mano un DB con una carta e un chunk.

- [ ] **Step 4: Documentazione**
  - `evals/README.md`: la riga «Il giudice attuale (`grade-v1`) dà un voto 0–5, convertito con…» diventa «Dalla Fase 2 il giudice (`grade-v2`) dà direttamente il verdetto, dopo aver elencato cosa chiede la domanda (`required`), cosa c'è, cosa manca e cosa è falso; riceve il `source` del caso. `grade-v1` (voto 0–5) era convertito con 0–2 → wrong, 3 → partial, 4–5 → correct.»
  - `CLAUDE.md`, nota «Eval dei prompt»: `oggi grade.ts → grade-v1` → `grade-v2`, e aggiungi il risultato di grade-v2 accanto alla baseline. Nota «Grading»: il giudice dà `verdict` (wrong/partial/correct) dopo `required/present/missing/errors`; `correct` con mancanze/errori → partial in codice; rating = `toRating` (wrong Again, partial Hard, correct Good; Easy solo manuale); sorgente da `tutor/gradingSource.ts` (chunk della carta ≤ 1500 caratteri o primo `retrieve`, mai bloccante). Nota «Review log»: `legacy_quality` non più scritta dalla Fase 2; `grader_rationale` = JSON del giudizio (righe precedenti testo). Nota «FSRS (Fase 1)»: togli «Voto 0–5 → rating con `ratingFromQuality` (temporaneo)».

- [ ] **Step 5: Verifica finale e commit**

Run: `npm run typecheck && npm test && npm run colors:check`
Expected: verde; riporta l'output di `colors:check` e le metriche dell'eval.

```bash
git add evals/README.md CLAUDE.md
git commit -m "Documenta il giudice a verdetti (Fase 2)"
```
