import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { convertStudioPart, prepareStudioLibrary } from "../src/lib/importers/fullStudio";

const { dir } = await useTempDb();
const { parseHtml, selectWork, walk } = await import("../src/lib/rag/sources/coursera");
const { analyzeFolder } = await import("../src/lib/ingestPlan");
const structure = {
  title: "Titolo / generico", codeBlocks: { example: { code: 'if (a < b) {\n  return "<script>";\n}', file: "esempio.ts" } },
  chapters: [{ id: "front", title: "Indice", front: true, sections: [] }, {
    id: "chapter", title: "Modulo", sections: [{ id: "section", title: "Lezione", blocks: [
      { type: "paragraph", plain: "Spiegazione originale & dettagli" },
      { type: "code", ref: "example" },
      { type: "list", ordered: true, items: [{ plain: "Primo", children: [{ plain: "Annidato", children: [] }] }] },
      { type: "table", headers: ["Campo"], rows: [["Valore"]] },
      { type: "callout", title: "Attenzione", blocks: [{ type: "paragraph", text: "Nota" }] },
    ] }] }],
};
const lesson = { title: "Titolo / generico", chapters: [{ id: "chapter", sections: [
  { id: "section", title: "Lezione", segments: [{ text: "Copione leggibile", tts: "copione fonetico", audio: "audio.mp3" }] },
  { id: "extra", title: "Approfondimento", segments: [{ text: "Sezione aggiunta nel copione" }] },
] }] };

test("conserva fonti, codice, annidamenti e sezioni aggiunte, senza markup attivo o fonetica", () => {
  const files = convertStudioPart(structure, lesson, 0);
  assert.equal(files.length, 2);
  const text = parseHtml(files[0].html);
  for (const expected of ["Spiegazione originale & dettagli", 'return "<script>"', "Annidato", "Valore", "Nota", "Copione leggibile"]) assert.ok(text.includes(expected), expected);
  assert.ok(!files[0].html.includes("<script>"));
  assert.ok(!text.includes("fonetico"));
  assert.ok(parseHtml(files[1].html).includes("Sezione aggiunta"));
  assert.equal(files[0].relativePath.split(path.sep).length, 4);
});

test("rifiuta riferimenti al codice mancanti e blocchi sconosciuti", () => {
  assert.throws(() => convertStudioPart({ ...structure, codeBlocks: {} }, lesson, 0));
  assert.throws(() => convertStudioPart({ ...structure, chapters: [{ id: "c", title: "C", sections: [{ id: "s", title: "S", blocks: [{ type: "unknown" }] }] }] }, lesson, 0), /non supportato/);
});

test("pubblica un macro importabile e non sovrascrive un'esportazione esistente", async () => {
  const source = path.join(dir, "source");
  for (const name of ["part1", "part2"]) {
    const part = path.join(source, "content", name);
    await fs.mkdir(part, { recursive: true });
    await fs.writeFile(path.join(part, "structure.json"), JSON.stringify(structure));
    await fs.writeFile(path.join(part, "lesson.json"), JSON.stringify(lesson));
  }
  const destination = path.join(dir, "library", "Studio");
  assert.deepEqual(await prepareStudioLibrary(source, destination), { parts: 2, lessons: 4 });
  const analysis = await analyzeFolder(destination);
  assert.equal(analysis?.kind, "macro");
  assert.equal(analysis?.courses.length, 2);
  for (const course of analysis!.courses) {
    assert.equal(course.counts.html, 2);
    assert.equal(selectWork(await walk(course.path), false).length, 2);
  }
  const before = await fs.readFile(path.join(destination, convertStudioPart(structure, lesson, 0)[0].relativePath), "utf8");
  await assert.rejects(prepareStudioLibrary(source, destination), { code: "EEXIST" });
  assert.equal(await fs.readFile(path.join(destination, convertStudioPart(structure, lesson, 0)[0].relativePath), "utf8"), before);
  assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), ["Studio"]);
});

test("un input non valido non pubblica una libreria parziale", async () => {
  const source = path.join(dir, "broken");
  await fs.mkdir(path.join(source, "content", "part1"), { recursive: true });
  await fs.writeFile(path.join(source, "content", "part1", "structure.json"), "{}");
  const destination = path.join(dir, "unpublished");
  await assert.rejects(prepareStudioLibrary(source, destination));
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
});
