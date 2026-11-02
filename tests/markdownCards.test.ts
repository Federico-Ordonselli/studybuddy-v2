import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownCards } from "@/lib/importers/markdownCards";
import { useTempDb } from "./helpers/db";

test("estrae testo letterale, codice e paragrafi saltando il preambolo", () => {
  const markdown = '# Titolo\r\nPreambolo\r\n\r\n**1. Come funziona?**\r\n\r\nPrima riga.\r\n\r\n```md\r\n**99. Esempio nel codice**\r\n```\r\n\r\n**2. Quale alternativa?**\r\n\r\nSeconda risposta.';
  assert.deepEqual(parseMarkdownCards(markdown), [
    { question: "Come funziona?", answer: 'Prima riga.\n\n```md\n**99. Esempio nel codice**\n```' },
    { question: "Quale alternativa?", answer: "Seconda risposta." },
  ]);
});

test("rifiuta importazioni vuote o incomplete", () => {
  assert.throws(() => parseMarkdownCards("# Solo testo"));
  assert.throws(() => parseMarkdownCards("**1. Domanda?**\n\n**2. Altra?**\nRisposta"));
  assert.throws(() => parseMarkdownCards("**1. Domanda?**\n" + "x".repeat(10001)));
});

test("API: salva nel corso, coda pronta, reimport idempotente e input invalido atomico", async () => {
  const { sqlite } = await useTempDb();
  const { POST } = await import("@/app/api/cards/route");
  const { NextRequest } = await import("next/server");
  const { nextDueCard, dueCount, listCards } = await import("@/lib/tutor/cards");
  sqlite.exec("INSERT INTO domains(id,name) VALUES(1,'Preparazione'),(2,'Altro')");
  const send = (markdown: string) => POST(new NextRequest("http://localhost/api/cards", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domainId: 1, markdown }),
  }));
  const markdown = "**1. Come funziona una closure?**\nConserva l’accesso allo scope.\n\n**2. A cosa serve una transazione?**\nRaggruppa operazioni atomiche.";
  const first = await send(markdown);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { created: 2, skipped: 0 });
  assert.equal(dueCount(1), 2);
  assert.equal(dueCount(2), 0);
  assert.deepEqual(nextDueCard(1), { id: 1, question: "Come funziona una closure?" });
  assert.equal(listCards(1)[0].answer, "Conserva l’accesso allo scope.");
  assert.deepEqual(await (await send(markdown)).json(), { created: 0, skipped: 2 });
  assert.equal((await send("**1. Nuova?**\nRisposta\n**2. Vuota?**")).status, 400);
  assert.equal(dueCount(1), 2);
});
