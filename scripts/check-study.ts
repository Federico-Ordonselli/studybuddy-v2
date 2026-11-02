/**
 * Controlla carte e domande di un pacchetto lezione prima di pubblicarlo:
 *
 *   npm run check:study -- <content/partN>
 *
 * Valida lesson.json e study.json (stesso codice dell'import), passa ogni carta da `checkCard` (le stesse
 * regole di qualità dell'anteprima delle carte) e cerca i duplicati fra carte. Exit 1 se c'è un problema.
 * Avvisa (senza fallire) per le sezioni con segmenti ma senza carte o senza domande.
 */
import fs from "node:fs";
import path from "node:path";
import { parseLesson, parseStudy } from "../src/lib/studioFormat";
import { checkCard, isDuplicateQuestion } from "../src/lib/tutor/cardQuality";

const dir = process.argv[2];
if (!dir) { console.error("Uso: npm run check:study -- <content/partN>"); process.exit(1); }
try {
  const lesson = parseLesson(JSON.parse(fs.readFileSync(path.join(dir, "lesson.json"), "utf8")));
  const study = parseStudy(JSON.parse(fs.readFileSync(path.join(dir, "study.json"), "utf8")), lesson);
  let problems = 0, cards = 0, quiz = 0;
  const seen: string[] = [];
  for (const chapter of lesson.chapters) {
    for (const section of chapter.sections) {
      const s = study.sections[section.id];
      if (section.segments.length && !s?.cards?.length) console.warn(`avviso  ${section.id}: nessuna carta`);
      if (section.segments.length && !s?.quiz?.length) console.warn(`avviso  ${section.id}: nessuna domanda`);
      for (const c of s?.cards ?? []) {
        cards++;
        const issues = checkCard({ question: c.q, answer: c.a });
        if (isDuplicateQuestion(c.q, seen)) issues.push({ code: "duplicate", message: "domanda quasi uguale a un'altra" });
        seen.push(c.q);
        for (const i of issues) { problems++; console.log(`carta   ${section.id}: [${i.code}] ${i.message}\n        D: ${c.q}\n        R: ${c.a}`); }
      }
      for (const q of s?.quiz ?? []) {
        quiz++;
        if (q.options.length !== 4) { problems++; console.log(`quiz    ${section.id}: servono 4 opzioni — ${q.q}`); }
        if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length) { problems++; console.log(`quiz    ${section.id}: opzioni ripetute — ${q.q}`); }
        if (!q.why.trim()) { problems++; console.log(`quiz    ${section.id}: manca la spiegazione — ${q.q}`); }
      }
    }
  }
  console.log(`\n${cards} carte, ${quiz} domande, ${problems} problemi`);
  process.exitCode = problems ? 1 : 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
