/**
 * Set di valutazione dei prompt (Fase 0 del piano di lavoro). Usa il modello vero
 * configurato in lib/config.ts, quindi resta fuori da `npm test`.
 *
 *   npm run eval -- grading [--limit N] [--only-confirmed]
 *
 * Dati in evals/data/ (gitignored: estratti di corsi), risultati in
 * evals/results/<data>-<modulo>-<PROMPT_VERSION>.json per confrontare due versioni.
 */
import fs from "node:fs";
import path from "node:path";
import { gradeAnswer, PROMPT_VERSION as GRADE_VERSION } from "@/lib/tutor/grade";
import { models } from "@/lib/config";
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
  const rows: (GradingOutcome & { quality: number | null; feedback: string; ms: number; error?: string })[] = [];
  for (const [i, c] of cases.entries()) {
    const t0 = Date.now();
    try {
      const g = await gradeAnswer(c.question, c.expected, c.answer);
      const model = verdictFromGrade(g);
      rows.push({ id: c.id, human: c.verdict, model, tags: c.tags, quality: g.quality, feedback: g.feedback, ms: Date.now() - t0 });
      const mark = model === c.verdict ? "=" : "≠";
      console.log(`  ${String(i + 1).padStart(2)} ${mark} ${c.id.padEnd(14)} umano ${c.verdict.padEnd(7)} modello ${model.padEnd(7)} (q${g.quality})`);
    } catch (e) {
      rows.push({ id: c.id, human: c.verdict, model: null, tags: c.tags, quality: null, feedback: "", ms: Date.now() - t0, error: String(e) });
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

const LATER: Record<string, string> = { cards: "Fase 3", tutor: "Fase 4", maps: "Fase 5" };

async function main() {
  const [module, ...args] = process.argv.slice(2);
  if (module === "grading") return runGrading(args);
  if (module && LATER[module]) throw new Error(`L'eval "${module}" arriva con la ${LATER[module]}.`);
  throw new Error("Uso: npm run eval -- grading [--limit N] [--only-confirmed]");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
