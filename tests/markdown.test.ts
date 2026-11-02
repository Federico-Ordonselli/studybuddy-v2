import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownSections, markdownRecords } from "@/lib/rag/sources/markdown";

const DOC = `---
title: prova
---
# Capitolo 1 — Sistemi

*Parte I*

## 1. I sistemi elaborativi

Un **sistema** è un insieme di elementi.

### 1.1 Hardware

Dispositivi fisici.

\`\`\`
# non è un titolo
\`\`\`

#### Dettaglio

Resta nella sezione 1.1.

## 2. Von Neumann

Il modello.
`;

test("markdownSections: titoli fino al livello 3, frontmatter tolto, # nei blocchi di codice ignorati", () => {
  const sections = markdownSections(DOC);
  assert.deepEqual(sections.map((s) => s.path), [
    ["Capitolo 1 — Sistemi"],
    ["Capitolo 1 — Sistemi", "1. I sistemi elaborativi"],
    ["Capitolo 1 — Sistemi", "1. I sistemi elaborativi", "1.1 Hardware"],
    ["Capitolo 1 — Sistemi", "2. Von Neumann"],
  ]);
  assert.ok(!sections.some((s) => s.body.includes("title: prova")));
  const hw = sections[2].body;
  assert.ok(hw.includes("# non è un titolo") && hw.includes("#### Dettaglio") && hw.includes("Resta nella sezione 1.1."));
});

test("markdownRecords: ogni chunk porta il percorso dei titoli nel testo e nel meta", () => {
  const records = markdownRecords(DOC);
  const vn = records.find((r) => r.content.includes("Il modello."))!;
  assert.equal((vn.meta as { section: string }).section, "Capitolo 1 — Sistemi › 2. Von Neumann");
  assert.ok(vn.content.startsWith("Capitolo 1 — Sistemi › 2. Von Neumann\n\n"));
  // Le sezioni con solo il titolo (nessun corpo) non producono chunk vuoti.
  assert.ok(records.every((r) => r.content.trim().length > 0));
});

test("markdownRecords: testo senza titoli = un'unica sezione senza percorso", () => {
  const records = markdownRecords("Solo testo.\n\nSecondo paragrafo.");
  assert.equal(records.length, 1);
  assert.equal(records[0].content, "Solo testo.\n\nSecondo paragrafo.");
  assert.equal(records[0].meta, undefined);
});

test("markdownRecords: le sezioni lunghe si spezzano in più chunk", () => {
  const long = "# T\n\n" + Array.from({ length: 200 }, (_, i) => `Paragrafo ${i} ${"parola ".repeat(30)}`).join("\n\n");
  const records = markdownRecords(long);
  assert.ok(records.length > 1);
  assert.ok(records.every((r) => r.content.startsWith("T\n\n")));
});
