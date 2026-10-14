import fs from "node:fs";
import path from "node:path";
import { generateGuide, PROMPT_VERSION, passageContext, SUMMARY_QUESTION, SUMMARY_PROMPT_VERSION } from "@/lib/lessonPrompts";
import { generateQuiz, PROMPT_VERSION as QUIZ_VERSION } from "@/lib/tutor/quiz";
import { gradeAnswer, PROMPT_VERSION as GRADE_VERSION } from "@/lib/tutor/grade";
import { models } from "@/lib/config";
import { checkCard } from "@/lib/tutor/cardQuality";

/** Materiale sintetico committabile: nessun corso o DB reale. Il merito si revisiona sui passaggi. */
export async function runLessons(args: string[]) {
  if (args.includes("--summary-results")) return runSummaryChecks(args[args.indexOf("--summary-results") + 1]);
  const fixture = path.resolve("evals/fixtures/lessons.json");
  let cases = JSON.parse(fs.readFileSync(fixture, "utf8")) as { id: string; title: string; content: string }[];
  const limit = Number(args[args.indexOf("--limit") + 1]);
  if (args.includes("--limit") && limit > 0) cases = cases.slice(0, limit);
  const rows: Record<string, unknown>[] = [];
  const started = new Date().toISOString();
  console.log(`lessons · ${cases.length} lezioni sintetiche · ${PROMPT_VERSION} / ${QUIZ_VERSION} · ${models.quiz.model}`);
  for (const c of cases) {
    const passages = [{ chunkId: 0, content: c.content }];
    const t0 = Date.now();
    try {
      const guide = await generateGuide(passages);
      const pretest = await generateQuiz(passageContext(passages), 3, { kind: "open", focus: "concepts" });
      const validPretest = pretest.length === 3 && new Set(pretest.map((q) => q.question.toLowerCase())).size === 3;
      const flagged = guide.filter((q) => checkCard(q).some((i) => ["yesno", "leak", "context"].includes(i.code)));
      rows.push({ id: c.id, title: c.title, source: c.content, guide, pretest, validPretest, flagged: flagged.length,
        review: { guideGrounded: null, guideUseful: null, pretestGrounded: null, pretestUseful: null, notes: "" }, ms: Date.now() - t0 });
      console.log(`  ${c.id}: ${guide.length} domande guida · ${pretest.length}/3 pretest · ${flagged.length} segnali domanda`);
    } catch (e) {
      rows.push({ id: c.id, error: String(e), ms: Date.now() - t0 });
      console.log(`  ! ${c.id}: ${String(e)}`);
    }
  }
  const completed = rows.filter((r) => !r.error).length;
  const valid = rows.filter((r) => r.validPretest).length;
  const metrics = { cases: cases.length, completed, failures: cases.length - completed, validPretest: valid };
  const out = path.resolve(`evals/results/lessons-${started.replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ promptVersion: PROMPT_VERSION, quizVersion: QUIZ_VERSION, model: models.quiz.model, runAt: started, metrics, rows }, null, 2));
  console.log(`Completate ${completed}/${cases.length} · pretest validi ${valid}/${cases.length}\nRisultati e revisione sui passaggi: ${out}`);
  if (completed !== cases.length || valid !== cases.length) throw new Error("Eval lezioni: output mancanti o pretest invalidi");
}

async function runSummaryChecks(file: string) {
  if (!file || !fs.existsSync(file)) throw new Error("Uso: npm run eval -- lessons --summary-results <risultati lessons.json>");
  const generated = JSON.parse(fs.readFileSync(file, "utf8")) as { rows: { id: string; source: string; guide: { question: string; answer: string }[] }[] };
  const fixtures = JSON.parse(fs.readFileSync(path.resolve("evals/fixtures/lessons.json"), "utf8")) as {
    id: string; summaryChecks?: { answer: string; gold: string }[];
  }[];
  const rows = [];
  const runAt = new Date().toISOString();
  console.log(`Riassunti · ${SUMMARY_PROMPT_VERSION} · giudice ${GRADE_VERSION}`);
  for (const c of fixtures) {
    if (!c.summaryChecks) continue;
    const generatedCase = generated.rows.find((r) => r.id === c.id);
    if (!generatedCase?.guide) throw new Error(`Mancano domande guida per ${c.id}`);
    const expected = generatedCase.guide.map((q) => `${q.question}\n${q.answer}`).join("\n\n");
    for (const check of c.summaryChecks) {
      const grade = await gradeAnswer(SUMMARY_QUESTION, expected, check.answer, passageContext([{ chunkId: 0, content: generatedCase.source }]));
      rows.push({ id: c.id, ...check, grade, agrees: check.gold === grade.verdict });
      console.log(`  ${c.id}: riferimento ${check.gold} · giudice ${grade.verdict}`);
    }
  }
  const correct = rows.filter((r) => r.agrees).length;
  const out = path.resolve(`evals/results/lesson-summaries-${runAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ promptVersion: SUMMARY_PROMPT_VERSION, guideVersion: PROMPT_VERSION, gradeVersion: GRADE_VERSION, model: models.grade.model, runAt,
    metrics: { total: rows.length, correct, agreement: rows.length ? correct / rows.length : 0 }, rows }, null, 2));
  console.log(`Accordo riassunti ${correct}/${rows.length} · risultati: ${out}`);
  if (!rows.length || correct / rows.length < 0.8) throw new Error("Eval riassunti: accordo sotto l'80%");
}
