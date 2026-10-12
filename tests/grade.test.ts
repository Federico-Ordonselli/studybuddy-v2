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

test("parseGrade: correct con errori viene declassato a partial, con sole mancanze resta correct", () => {
  assert.equal(parseGrade(verdictJson("correct", { errors: ["dice che blocca dopo"] }))?.verdict, "partial");
  assert.equal(parseGrade(verdictJson("correct", { missing: ["un dettaglio secondario"] }))?.verdict, "correct");
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
