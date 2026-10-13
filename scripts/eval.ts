/**
 * Set di valutazione dei prompt (Fase 0 del piano di lavoro). Usa il modello vero
 * configurato in lib/config.ts, quindi resta fuori da `npm test`.
 *
 *   npm run eval -- grading [--limit N] [--only-confirmed]
 *   npm run eval -- cards [--limit N]            genera carte dal set e misura il controllo di qualità
 *   npm run eval -- cards --build <db> [--force]  crea cards.jsonl: 30 passaggi di trascrizione da 3 corsi (sola lettura)
 *   npm run eval -- cards-review <file>           conta le carte tenute nella revisione manuale
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

/** Campiona il set da un DB (aperto in sola lettura): 10 passaggi lunghi per ciascuno dei 3 corsi con più trascrizioni. */
function buildCards(dbPath: string, force: boolean) {
  const out = path.join(ROOT, "data", "cards.jsonl");
  if (fs.existsSync(out) && !force) throw new Error(`${out} esiste già: usa --force per sostituirlo`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const courses = db.prepare(`SELECT n.id, n.name, count(*) AS c FROM chunks c JOIN documents d ON d.id = c.document_id JOIN domains n ON n.id = d.domain_id
      WHERE d.kind = 'transcript' AND length(c.content) >= 400 GROUP BY n.id ORDER BY c DESC LIMIT 3`).all() as { id: number; name: string; c: number }[];
    if (courses.length < 3) console.log(`  attenzione: solo ${courses.length} corsi con trascrizioni`);
    const pick = db.prepare(`SELECT c.id, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.domain_id = ? AND d.kind = 'transcript' AND length(c.content) >= 400 ORDER BY d.id, c.ordinal`);
    const lines: string[] = [];
    for (const course of courses) {
      const rows = pick.all(course.id) as { id: number; content: string }[];
      const k = Math.min(10, rows.length);
      for (let i = 0; i < k; i++) {
        const r = rows[Math.floor((i * rows.length) / k)];
        lines.push(JSON.stringify({ id: `c${course.id}-${i + 1}`, course: course.name, content: r.content, docKind: "transcript", chunkId: r.id }));
      }
      console.log(`  ${course.name}: ${k} passaggi`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join("\n") + "\n");
    console.log(`scritto ${path.relative(process.cwd(), out)} (${lines.length} passaggi)`);
  } finally { db.close(); }
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

const LATER: Record<string, string> = { tutor: "Fase 4", maps: "Fase 5" };

async function main() {
  const [module, ...args] = process.argv.slice(2);
  if (module === "grading") return runGrading(args);
  if (module === "cards") return runCards(args);
  if (module === "cards-review") return runCardsReview(args);
  if (module && LATER[module]) throw new Error(`L'eval "${module}" arriva con la ${LATER[module]}.`);
  throw new Error("Uso: npm run eval -- grading [--limit N] [--only-confirmed] | cards [--limit N] | cards --build <db> | cards-review <file>");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
