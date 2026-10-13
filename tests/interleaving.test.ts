import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers/db";

const { sqlite } = await useTempDb();
const { nextDueCard } = await import("@/lib/tutor/cards");

// Macro 1 con due corsi (2, 3). Moduli: corso 2 → A e B, corso 3 → A (stesso nome, altro corso).
sqlite.exec(`
  INSERT INTO domains(id,name) VALUES(1,'macro'),(2,'corso uno'),(3,'corso due'),(9,'altrove');
  UPDATE domains SET parent_id=1 WHERE id IN (2,3);
  INSERT INTO documents(id,domain_id,title,meta) VALUES
    (20,2,'a1','{"module":"01_A"}'),(21,2,'b1','{"module":"02_B"}'),(30,3,'a2','{"module":"01_A"}'),(90,9,'x','{"module":"02_B"}');
  INSERT INTO chunks(id,document_id,ordinal,content) VALUES(200,20,0,'a'),(210,21,0,'b'),(300,30,0,'c'),(900,90,0,'x');
`);
const card = (id: number, domain: number, chunk: number | null, due: number) =>
  sqlite.prepare("INSERT INTO cards(id,domain_id,question,answer,source_chunk_id,due_at,fsrs_state) VALUES(?,?,?,?,?,?,2)").run(id, domain, `D${id}?`, "R", chunk, due);
const reviewed = (cardId: number, at: number) =>
  sqlite.prepare("INSERT INTO review_logs(card_id,reviewed_at,rating,answer) VALUES(?,?,3,'r')").run(cardId, at);

test("senza ripassi precedenti: la più scaduta", () => {
  card(1, 2, 200, 100);   // modulo A del corso uno, la più scaduta
  card(2, 2, 200, 200);   // stesso modulo
  card(3, 2, 210, 300);   // modulo B
  assert.equal(nextDueCard(1)?.id, 1);
});

test("dopo una carta del modulo A: la più scaduta di un altro modulo", () => {
  reviewed(1, 1000);      // l'ultima ripassata è del modulo A (corso uno)
  sqlite.exec("UPDATE cards SET due_at = 5000000000 WHERE id = 1");
  assert.equal(nextDueCard(1)?.id, 3);
});

test("lo stesso nome di modulo in un altro corso è un modulo diverso", () => {
  card(4, 3, 300, 250);   // modulo A del corso due: più scaduta della 3
  assert.equal(nextDueCard(1)?.id, 4);
});

test("le carte senza sorgente non bloccano la scelta", () => {
  sqlite.exec("DELETE FROM cards WHERE id IN (3,4)");
  card(5, 2, null, 400);  // modulo sconosciuto
  assert.equal(nextDueCard(1)?.id, 5);
});

test("se restano solo carte dello stesso modulo, la più scaduta", () => {
  sqlite.exec("DELETE FROM cards WHERE id = 5");
  assert.equal(nextDueCard(1)?.id, 2);
});

test("l'ultima ripassata conta solo nello scope: un ripasso in un altro dominio non cambia la scelta", () => {
  card(6, 2, 210, 250);   // modulo B, meno scaduta della 2 (A)
  card(7, 9, 900, 0);
  reviewed(7, 2000);      // ripasso più recente, ma fuori dal macro
  assert.equal(nextDueCard(1)?.id, 6);  // l'ultima nello scope è ancora la 1 (modulo A) → B
});
