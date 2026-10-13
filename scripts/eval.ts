/**
 * Set di valutazione dei prompt (Fase 0 del piano di lavoro). Usa il modello vero
 * configurato in lib/config.ts, quindi resta fuori da `npm test`.
 *
 *   npm run eval -- grading [--limit N] [--only-confirmed]
 *   npm run eval -- cards [--limit N]            genera carte dal set e misura il controllo di qualità
 *   npm run eval -- cards --build <db> [--force]  crea cards.jsonl: 30 passaggi di trascrizione da 3 corsi (sola lettura)
 *   npm run eval -- cards-review <file>           conta le carte tenute nella revisione manuale
 *   npm run eval -- tutor [--limit N] [--baseline]  richieste di soluzione: intercettate e tempi (--baseline = prompt tutor-v0)
 *   npm run eval -- tutor --build <db> [--force]  bozza tutor.draft.jsonl dai passaggi di 3 corsi (sola lettura)
 *   npm run eval -- tutor-review <file>           conta soluzioni date e spiegazioni nella revisione manuale
 *   npm run eval -- maps [--limit N]               valuta le proposizioni di maps.jsonl (accordo col verdetto di riferimento)
 *   npm run eval -- maps --build <db> [--force]    bozza maps.draft.jsonl: 6 mappe in modalità build da 3 corsi (DB in sola lettura)
 *
 * Dati in evals/data/ (gitignored: estratti di corsi), risultati in
 * evals/results/<data>-<modulo>-<PROMPT_VERSION>.json per confrontare due versioni.
 */
import fs from "node:fs";
import path from "node:path";
import { gradeAnswer, PROMPT_VERSION as GRADE_VERSION } from "@/lib/tutor/grade";
import Database from "better-sqlite3";
import { models } from "@/lib/config";
import { generateCardDrafts, PROMPT_VERSION as CARDS_VERSION } from "@/lib/tutor/cardGen";
import { cardMetrics, parseCardCases, reviewSample, reviewScore, type CardCaseOutcome } from "@/lib/evals/cards";
import { guardedSocratic, socraticOptions, PROMPT_VERSION as TUTOR_VERSION } from "@/lib/tutor/session";
import { isSolutionRequest } from "@/lib/tutor/guard";
import { generate } from "@/lib/providers";
import { LEGACY_SYSTEM, parseTutorCases, tutorMetrics, tutorReviewSample, tutorReviewScore, type TutorOutcome } from "@/lib/evals/tutor";
import { judgePropositions, PROMPT_VERSION as MAPS_VERSION } from "@/lib/mapExercise";
import { proposeMap } from "@/lib/conceptmap";
import { mapMetrics, parseMapCases, referenceFor, type MapOutcome } from "@/lib/evals/maps";
import type { Retrieved } from "@/lib/rag/store";
import { gradingMetrics, parseGradingCases, verdictFromGrade, VERDICTS, type GradingOutcome } from "@/lib/evals/grading";

const ROOT = path.resolve("evals");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function runGrading(args: string[]) {
  const file = path.join(ROOT, "data", "grading.jsonl");
  if (!fs.existsSync(file)) throw new Error(`Manca ${file}: vedi evals/README.md`);
  let cases = parseGradingCases(fs.readFileSync(file, "utf8"));
  const unconfirmed = cases.filter((c) => !c.confirmed).length;
  if (args.includes("--only-confirmed")) cases = cases.filter((c) => c.confirmed);
  const limit = Number(flag(args, "--limit"));
  if (limit > 0) cases = cases.slice(0, limit);
  if (!cases.length) throw new Error("Nessun caso da valutare.");

  console.log(`grading · ${cases.length} casi · prompt ${GRADE_VERSION} · modello ${models.grade.model}`);
  if (unconfirmed && !args.includes("--only-confirmed")) {
    console.log(`  attenzione: ${unconfirmed} casi con verdetto non ancora confermato ("confirmed": true)`);
  }
  const started = Date.now();
  const rows: (GradingOutcome & { missing: string[]; errors: string[]; feedback: string; ms: number; error?: string })[] = [];
  for (const [i, c] of cases.entries()) {
    const t0 = Date.now();
    try {
      const g = await gradeAnswer(c.question, c.expected, c.answer, c.source);
      const model = verdictFromGrade(g);
      rows.push({ id: c.id, human: c.verdict, model, tags: c.tags, missing: g.missing, errors: g.errors, feedback: g.feedback, ms: Date.now() - t0 });
      const mark = model === c.verdict ? "=" : "≠";
      console.log(`  ${String(i + 1).padStart(2)} ${mark} ${c.id.padEnd(14)} umano ${c.verdict.padEnd(7)} modello ${model.padEnd(7)}`);
      if (model !== c.verdict) console.log(`    mancava: ${g.missing.join("; ") || "—"} · errori: ${g.errors.join("; ") || "—"}`);
    } catch (e) {
      rows.push({ id: c.id, human: c.verdict, model: null, tags: c.tags, missing: [], errors: [], feedback: "", ms: Date.now() - t0, error: String(e) });
      console.log(`  ${String(i + 1).padStart(2)} ! ${c.id.padEnd(14)} errore del giudice`);
    }
  }

  const m = gradingMetrics(rows);
  console.log(`\naccordo esatto ${pct(m.exact)} · entro 1 ${pct(m.withinOne)} · su ${m.judged}/${m.total} (errori ${m.failures})`);
  console.log(`"sbagliata ma lunga" promosse a correct: ${m.longWrongAsCorrect}`);
  console.log("\nmatrice (righe = umano, colonne = modello)");
  console.log("           " + VERDICTS.map((v) => v.padStart(8)).join(""));
  for (const h of VERDICTS) console.log(h.padEnd(11) + VERDICTS.map((v) => String(m.confusion[h][v]).padStart(8)).join(""));
  console.log("\naccordo per tag");
  for (const [tag, t] of Object.entries(m.byTag)) console.log(`  ${tag.padEnd(12)} ${pct(t.exact).padStart(6)}  (${t.n})`);
  console.log(`\ntempo medio ${(rows.reduce((s, r) => s + r.ms, 0) / rows.length / 1000).toFixed(1)}s per caso`);

  const outDir = path.join(ROOT, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${new Date().toISOString().slice(0, 10)}-grading-${GRADE_VERSION}.json`);
  fs.writeFileSync(out, JSON.stringify({
    module: "grading", promptVersion: GRADE_VERSION, model: models.grade.model,
    runAt: new Date(started).toISOString(), metrics: m, cases: rows,
  }, null, 2));
  console.log(`risultati: ${path.relative(process.cwd(), out)}`);
}

/** 10 passaggi di trascrizione lunghi (≥ 400 caratteri) da ciascuno dei 3 corsi con più trascrizioni, DB in sola lettura. */
function samplePassages(dbPath: string, perCourse = 10): { course: { id: number; name: string }; id: number; content: string; i: number }[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const courses = db.prepare(`SELECT n.id, n.name, count(*) AS c FROM chunks c JOIN documents d ON d.id = c.document_id JOIN domains n ON n.id = d.domain_id
      WHERE d.kind = 'transcript' AND length(c.content) >= 400 GROUP BY n.id ORDER BY c DESC LIMIT 3`).all() as { id: number; name: string; c: number }[];
    if (courses.length < 3) console.log(`  attenzione: solo ${courses.length} corsi con trascrizioni`);
    const pick = db.prepare(`SELECT c.id, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.domain_id = ? AND d.kind = 'transcript' AND length(c.content) >= 400 ORDER BY d.id, c.ordinal`);
    const out: { course: { id: number; name: string }; id: number; content: string; i: number }[] = [];
    for (const course of courses) {
      const rows = pick.all(course.id) as { id: number; content: string }[];
      const k = Math.min(perCourse, rows.length);
      for (let i = 0; i < k; i++) {
        const r = rows[Math.floor((i * rows.length) / k)];
        out.push({ course: { id: course.id, name: course.name }, id: r.id, content: r.content, i });
      }
      console.log(`  ${course.name}: ${k} passaggi`);
    }
    return out;
  } finally { db.close(); }
}

/** Campiona il set da un DB (aperto in sola lettura): 10 passaggi lunghi per ciascuno dei 3 corsi con più trascrizioni. */
function buildCards(dbPath: string, force: boolean) {
  const out = path.join(ROOT, "data", "cards.jsonl");
  if (fs.existsSync(out) && !force) throw new Error(`${out} esiste già: usa --force per sostituirlo`);
  const lines = samplePassages(dbPath).map((r) => JSON.stringify({ id: `c${r.course.id}-${r.i + 1}`, course: r.course.name, content: r.content, docKind: "transcript", chunkId: r.id }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`scritto ${path.relative(process.cwd(), out)} (${lines.length} passaggi)`);
}

async function runCards(args: string[]) {
  const build = flag(args, "--build");
  if (build) return buildCards(build, args.includes("--force"));
  const file = path.join(ROOT, "data", "cards.jsonl");
  if (!fs.existsSync(file)) throw new Error(`Manca ${file}: crealo con npm run eval -- cards --build <db> (vedi evals/README.md)`);
  let cases = parseCardCases(fs.readFileSync(file, "utf8"));
  const limit = Number(flag(args, "--limit"));
  if (limit > 0) cases = cases.slice(0, limit);
  if (!cases.length) throw new Error("Nessun caso da valutare.");

  console.log(`cards · ${cases.length} passaggi · prompt ${CARDS_VERSION} · modello ${models.quiz.model}`);
  const started = Date.now();
  const rows: (CardCaseOutcome & { ms: number })[] = [];
  for (const [i, c] of cases.entries()) {
    const t0 = Date.now();
    try {
      const drafts = await generateCardDrafts([{ chunkId: c.chunkId ?? 0, content: c.content, docKind: c.docKind }], { n: 5 });
      rows.push({ id: c.id, course: c.course, cards: drafts.map(({ question, answer, fact, type, issues }) => ({ question, answer, fact, type, issues })), ms: Date.now() - t0 });
      const ok = drafts.filter((d) => !d.issues.length).length;
      console.log(`  ${String(i + 1).padStart(2)} ${c.id.padEnd(10)} ${ok}/${drafts.length} valide`);
      for (const d of drafts.filter((d) => d.issues.length)) console.log(`      ✗ ${d.issues.map((x) => x.code).join(",")}: ${d.question}`);
    } catch (e) {
      rows.push({ id: c.id, course: c.course, cards: [], error: String(e), ms: Date.now() - t0 });
      console.log(`  ${String(i + 1).padStart(2)} ! ${c.id} errore del modello`);
    }
  }

  const m = cardMetrics(rows);
  console.log(`\npassano il controllo ${pct(m.passRate)} (${m.passed}/${m.cards}) · obiettivo 85%`);
  console.log(`passaggi senza carte ${m.emptyCases} · errori ${m.failures}`);
  console.log("problemi: " + (Object.entries(m.byIssue).map(([k, v]) => `${k} ${v}`).join(" · ") || "nessuno"));
  for (const [course, t] of Object.entries(m.byCourse)) console.log(`  ${course.slice(0, 40).padEnd(40)} ${pct(t.passRate).padStart(6)}  (${t.cards})`);
  console.log(`tempo medio ${(rows.reduce((s, r) => s + r.ms, 0) / rows.length / 1000).toFixed(1)}s per passaggio`);

  const outDir = path.join(ROOT, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.join(outDir, `${new Date().toISOString().slice(0, 10)}-cards-${CARDS_VERSION}`);
  fs.writeFileSync(`${stem}.json`, JSON.stringify({
    module: "cards", promptVersion: CARDS_VERSION, model: models.quiz.model,
    runAt: new Date(started).toISOString(), metrics: m, cases: rows,
  }, null, 2));
  fs.writeFileSync(`${stem}-review.jsonl`, reviewSample(rows).map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`risultati: ${path.relative(process.cwd(), stem)}.json`);
  console.log(`revisione: compila "keep" (true/false) in ${path.relative(process.cwd(), stem)}-review.jsonl, poi npm run eval -- cards-review <file>`);
}

function runCardsReview(args: string[]) {
  const file = args[0];
  if (!file || !fs.existsSync(file)) throw new Error("Uso: npm run eval -- cards-review <file -review.jsonl>");
  const r = reviewScore(fs.readFileSync(file, "utf8"));
  console.log(`tenute senza modifiche ${r.kept}/${r.reviewed}${r.pending ? ` · ${r.pending} ancora da rivedere` : ""} · obiettivo 17/20`);
}

/** Bozza del set: un passaggio per riga, `message` vuoto da scrivere a mano (vedi evals/README.md). */
function buildTutor(dbPath: string, force: boolean) {
  const out = path.join(ROOT, "data", "tutor.draft.jsonl");
  if (fs.existsSync(out) && !force) throw new Error(`${out} esiste già: usa --force per sostituirlo`);
  const rows = samplePassages(dbPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => JSON.stringify({ id: `t${r.course.id}-${r.i + 1}`, course: r.course.name, kind: "exercise", context: r.content, history: [], message: "", chunkId: r.id })).join("\n") + "\n");
  console.log(`scritto ${path.relative(process.cwd(), out)} (${rows.length} passaggi): scrivi i messaggi e salvalo come tutor.jsonl`);
}

async function runTutor(args: string[]) {
  const build = flag(args, "--build");
  if (build) return buildTutor(build, args.includes("--force"));
  const file = path.join(ROOT, "data", "tutor.jsonl");
  if (!fs.existsSync(file)) throw new Error(`Manca ${file}: crealo con npm run eval -- tutor --build <db> (vedi evals/README.md)`);
  let cases = parseTutorCases(fs.readFileSync(file, "utf8"));
  const limit = Number(flag(args, "--limit"));
  if (limit > 0) cases = cases.slice(0, limit);
  const baseline = args.includes("--baseline");
  const version = baseline ? "tutor-v0" : TUTOR_VERSION;
  console.log(`tutor · ${cases.length} casi · prompt ${version} · modello ${models.chat.model}`);
  const started = Date.now();
  const rows: TutorOutcome[] = [];
  for (const [i, c] of cases.entries()) {
    const context = `[1] ${c.context}`;
    const guarded = !baseline && isSolutionRequest(c.message);
    const t0 = Date.now();
    try {
      const r = baseline
        ? { reply: await generate("chat", { system: `${LEGACY_SYSTEM}\n\nContesto:\n${context}`, temperature: 0.6, messages: [...c.history, { role: "user", content: c.message }] }), blocked: 0, fallback: false }
        : guarded
          ? await guardedSocratic(c.history, c.message, context, c.level)
          : { reply: await generate("chat", socraticOptions(c.history, c.message, context, c.level)), blocked: 0, fallback: false };
      // in baseline il turno è "a rischio" se lo sarebbe col v1: serve a confrontare i tempi
      rows.push({ id: c.id, kind: c.kind, reply: r.reply, guarded: baseline ? isSolutionRequest(c.message) : guarded, blocked: r.blocked, fallback: r.fallback, ms: Date.now() - t0 });
      console.log(`  ${String(i + 1).padStart(2)} ${c.id.padEnd(10)} ${c.kind.padEnd(11)} ${r.blocked ? `bloccate ${r.blocked}${r.fallback ? " → indizio fisso" : ""}` : "—"}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      rows.push({ id: c.id, kind: c.kind, reply: "", guarded, blocked: 0, fallback: false, ms: Date.now() - t0, error: String(e) });
      console.log(`  ${String(i + 1).padStart(2)} ! ${c.id} errore del modello`);
    }
  }
  const m = tutorMetrics(rows);
  console.log(`\nturni a rischio ${m.risky} · intercettati ${m.intercepted} · indizio fisso ${m.fallbacks} · errori ${m.failures}`);
  console.log(`tempo medio: a rischio ${(m.msRisky / 1000).toFixed(1)}s · altri ${(m.msOther / 1000).toFixed(1)}s`);
  const outDir = path.join(ROOT, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.join(outDir, `${new Date().toISOString().slice(0, 10)}-tutor-${version}`);
  fs.writeFileSync(`${stem}.json`, JSON.stringify({ module: "tutor", promptVersion: version, model: models.chat.model, runAt: new Date(started).toISOString(), metrics: m, cases: rows }, null, 2));
  fs.writeFileSync(`${stem}-review.jsonl`, tutorReviewSample(cases, rows).map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`risultati: ${path.relative(process.cwd(), stem)}.json`);
  console.log(`revisione: compila "leak"/"explains" in ${path.relative(process.cwd(), stem)}-review.jsonl, poi npm run eval -- tutor-review <file>`);
}

function runTutorReview(args: string[]) {
  const file = args[0];
  if (!file || !fs.existsSync(file)) throw new Error("Uso: npm run eval -- tutor-review <file -review.jsonl>");
  const r = tutorReviewScore(fs.readFileSync(file, "utf8"));
  console.log(`esercizi con la soluzione data ${r.leaks}/${r.exercises} (${pct(r.leakRate)}) · obiettivo < 10%`);
  console.log(`spiegazioni date ${r.explained}/${r.explanations}${r.pending ? ` · ${r.pending} ancora da rivedere` : ""}`);
}

/** I 3 domini con più chunk di testo; per ciascuno 2 moduli (i più ricchi) con fino a 14 chunk lunghi (max 3 per documento). DB in sola lettura. */
function sampleModules(dbPath: string): { course: { id: number; name: string }; topic: string; chunks: Retrieved[] }[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const kinds = `d.kind IN ('transcript','html','pdf','text')`;
    const courses = db.prepare(`SELECT n.id, n.name, count(*) AS c FROM chunks c JOIN documents d ON d.id = c.document_id JOIN domains n ON n.id = d.domain_id
      WHERE ${kinds} GROUP BY n.id ORDER BY c DESC LIMIT 3`).all() as { id: number; name: string }[];
    const modules = db.prepare(`SELECT json_extract(d.meta, '$.module') AS module, count(*) AS c FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.domain_id = ? AND ${kinds} AND json_extract(d.meta, '$.module') IS NOT NULL GROUP BY module ORDER BY c DESC LIMIT 2`);
    const pick = db.prepare(`SELECT c.id AS chunkId, c.document_id AS documentId, c.content, c.meta AS chunkMeta, d.source, d.kind, d.meta
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.domain_id = ? AND ${kinds} AND json_extract(d.meta, '$.module') = ? AND length(c.content) >= 300 ORDER BY d.id, c.ordinal`);
    const out: { course: { id: number; name: string }; topic: string; chunks: Retrieved[] }[] = [];
    for (const course of courses) {
      for (const m of modules.all(course.id) as { module: string }[]) {
        const perDoc = new Map<number, number>();
        const chunks: Retrieved[] = [];
        for (const r of pick.all(course.id, m.module) as { chunkId: number; documentId: number; content: string; chunkMeta: string | null; source: string | null; kind: string; meta: string | null }[]) {
          if (chunks.length >= 14) break;
          const n = perDoc.get(r.documentId) ?? 0;
          if (n >= 3) continue;
          perDoc.set(r.documentId, n + 1);
          chunks.push({ chunkId: r.chunkId, documentId: r.documentId, content: r.content, distance: 0, source: r.source, docKind: r.kind, docMeta: JSON.parse(r.meta ?? "{}"), meta: r.chunkMeta ? JSON.parse(r.chunkMeta) : undefined });
        }
        const topic = m.module.replace(/^[\d\s._-]+/, "").replace(/_/g, " ").trim();
        if (chunks.length) out.push({ course: { id: course.id, name: course.name }, topic, chunks });
        console.log(`  ${course.name} · ${topic}: ${chunks.length} chunk`);
      }
    }
    return out;
  } finally { db.close(); }
}

/** Bozza del set: mappe in modalità build, `propositions` vuoto da scrivere a mano (vedi evals/README.md). */
async function buildMaps(dbPath: string, force: boolean) {
  const out = path.join(ROOT, "data", "maps.draft.jsonl");
  if (fs.existsSync(out) && !force) throw new Error(`${out} esiste già: usa --force per sostituirlo`);
  const lines: string[] = [];
  const counter = new Map<number, number>();
  for (const { course, topic, chunks } of sampleModules(dbPath)) {
    const k = (counter.get(course.id) ?? 0) + 1;
    counter.set(course.id, k);
    try {
      const m = await proposeMap(course.id, topic, chunks, { build: true });
      lines.push(JSON.stringify({
        id: `m${course.id}-${k}`, course: course.name, topic, focusQuestion: m.focusQuestion,
        concepts: m.concepts.map((c) => ({ title: c.title, definition: c.definition })),
        solution: m.relations,
        passages: chunks.map((c, i) => ({ n: i + 1, chunkId: c.chunkId, text: c.content.slice(0, 1500) })),
        propositions: [],
      }));
      console.log(`  ok ${course.name} · ${topic}`);
    } catch (e) {
      console.log(`  ! ${course.name} · ${topic}: ${e instanceof Error ? e.message : e}`);
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`scritto ${path.relative(process.cwd(), out)} (${lines.length} mappe): ora scrivi le proposizioni e salva come evals/data/maps.jsonl (vedi evals/README.md)`);
}

async function runMaps(args: string[]) {
  const build = flag(args, "--build");
  if (build) return buildMaps(build, args.includes("--force"));
  const file = path.join(ROOT, "data", "maps.jsonl");
  if (!fs.existsSync(file)) throw new Error(`Manca ${file}: crealo con npm run eval -- maps --build <db> (vedi evals/README.md)`);
  let cases = parseMapCases(fs.readFileSync(file, "utf8"));
  const limit = Number(flag(args, "--limit"));
  if (limit > 0) cases = cases.slice(0, limit);
  if (!cases.length) throw new Error("Nessun caso da valutare.");

  console.log(`maps · ${cases.length} casi · ${cases.reduce((s, c) => s + c.propositions.length, 0)} proposizioni · prompt ${MAPS_VERSION} · modello ${models.grade.model}`);
  const started = Date.now();
  const rows: MapOutcome[] = [];
  for (const c of cases) {
    const mine: MapOutcome[] = [];
    for (let i = 0; i < c.propositions.length; i += 15) {
      const block = c.propositions.slice(i, i + 15);
      try {
        const js = await judgePropositions({
          focusQuestion: c.focusQuestion,
          propositions: block.map((p) => ({ id: p.id, from: p.from, label: p.label, to: p.to, reference: referenceFor(c, p) })),
          passages: c.passages.map((p) => p.text),
          concepts: c.concepts,
        });
        for (const p of block) mine.push({ caseId: c.id, propId: p.id, kind: p.kind, gold: p.gold, got: js.find((j) => j.id === p.id)?.verdict ?? "unrated" });
      } catch {
        for (const p of block) mine.push({ caseId: c.id, propId: p.id, kind: p.kind, gold: p.gold, got: "error" });
      }
    }
    rows.push(...mine);
    const bad = mine.filter((r) => r.got !== r.gold);
    console.log(`  ${c.id.padEnd(10)} ${mine.length - bad.length}/${mine.length}`);
    for (const r of bad) console.log(`      ${r.propId}: gold ${r.gold}, got ${r.got}`);
  }

  const m = mapMetrics(rows);
  console.log(`\naccordo esatto ${pct(m.agreement)} (${rows.filter((r) => r.got === r.gold).length}/${m.total}) · obiettivo 80%`);
  console.log("accordo per kind");
  for (const [k, t] of Object.entries(m.byKind)) console.log(`  ${k.padEnd(13)} ${pct(t.n ? t.agree / t.n : 0).padStart(6)}  (${t.n})`);
  console.log(`absent-valid bocciate ${m.absentValidRejected}/${m.absentValid}`);
  console.log("\nmatrice (righe = riferimento, colonne = modello)");
  const cols = ["valid", "imprecise", "wrong", "unrated", "error"];
  console.log("            " + cols.map((v) => v.padStart(10)).join(""));
  for (const g of ["valid", "imprecise", "wrong"]) console.log(g.padEnd(12) + cols.map((v) => String(m.confusion[g]?.[v] ?? 0).padStart(10)).join(""));

  const outDir = path.join(ROOT, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `maps-${new Date(started).toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ promptVersion: MAPS_VERSION, model: models.grade.model, runAt: new Date(started).toISOString(), metrics: m, rows }, null, 2));
  console.log(`risultati: ${path.relative(process.cwd(), out)}`);
}

async function main() {
  const [module, ...args] = process.argv.slice(2);
  if (module === "grading") return runGrading(args);
  if (module === "cards") return runCards(args);
  if (module === "cards-review") return runCardsReview(args);
  if (module === "tutor") return runTutor(args);
  if (module === "tutor-review") return runTutorReview(args);
  if (module === "maps") return runMaps(args);
  throw new Error("Uso: npm run eval -- grading [--limit N] [--only-confirmed] | cards [--limit N] | cards --build <db> | cards-review <file> | tutor [--limit N] [--baseline] | tutor --build <db> | tutor-review <file> | maps [--limit N] | maps --build <db>");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
