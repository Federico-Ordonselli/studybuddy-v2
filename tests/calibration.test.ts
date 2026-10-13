import { test, before } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

let H: typeof import("@/lib/home");
let sqlite: import("better-sqlite3").Database;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

/** Una review: `rating` 1–4, `confidence` 1–3 o null, `ago` giorni fa. */
function log(cardId: number, rating: number, confidence: number | null, ago = 1, overridden = 0) {
  sqlite.prepare("INSERT INTO review_logs (card_id, reviewed_at, rating, confidence, answer, overridden) VALUES (?, ?, ?, ?, 'r', ?)")
    .run(cardId, now() - ago * DAY, rating, confidence, overridden);
}

before(async () => {
  ({ sqlite } = await useTempDb());
  H = await import("@/lib/home");
  sqlite.exec(`INSERT INTO domains (id, name, kind) VALUES (1, 'Macro', 'macro');
    INSERT INTO domains (id, name, parent_id) VALUES (2, 'Corso A', 1), (3, 'Corso B', NULL);
    INSERT INTO cards (id, domain_id, question, answer) VALUES (1, 2, 'q', 'a'), (2, 3, 'q', 'a');`);
  log(1, 4, 3); log(1, 1, 3); log(1, 3, 3);            // Sicuro: 2 su 3 corrette (Easy, Good)
  log(1, 2, 2); log(1, 3, 2);                          // Abbastanza: Hard non conta come corretta
  log(2, 1, 1);                                        // Non sicuro, su un altro corso
  log(2, 3, 3, 40);                                    // fuori finestra
  log(2, 3, null);                                     // senza fiducia (prima della Fase 6)
  log(2, 1, 3, 1, 1); log(2, 3, 3);                    // originale corretto a mano: conta solo la correzione
});

test("calibration: per livello di fiducia, quante risposte corrette (Good/Easy) negli ultimi 30 giorni", () => {
  const c = H.calibration();
  assert.deepEqual(c.levels.map((l) => [l.confidence, l.total, l.correct]), [[1, 1, 0], [2, 2, 1], [3, 4, 3]]);
  assert.equal(c.levels[2].pct, 75);
  assert.equal(c.overconfident, false);
});

test("calibration: scopabile per dominio (un macro include i figli) e per finestra", () => {
  assert.deepEqual(H.calibration(1).levels.map((l) => l.total), [0, 2, 3]);
  assert.deepEqual(H.calibration(3, 60).levels.map((l) => l.total), [1, 0, 2]);
  assert.equal(H.calibration(1).levels[0].pct, null);
});

test("calibration: segnala «Sicuro» sotto il 70% solo con almeno 20 review", () => {
  sqlite.exec("INSERT INTO cards (id, domain_id, question, answer) VALUES (3, 3, 'q', 'a')");
  for (let i = 0; i < 19; i++) log(3, i < 9 ? 3 : 1, 3);
  assert.equal(H.calibration(3).levels[2].total, 20);
  assert.equal(H.calibration(3).overconfident, true); // 10/20 = 50%
  assert.equal(H.calibration(2).overconfident, false); // 2/3: troppo poche
});
