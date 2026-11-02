import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, initialPlayerState, panelAt, playerReducer, timeline, type PlayerAction } from "@/lib/client/studioPlayer";
import type { Lesson } from "@/lib/studioTypes";

const seg = (id: string, extra: object = {}) => ({ id, text: id, duration: 10, ...extra });
const LESSON: Lesson = {
  part: 1, title: "T", subtitle: "", codeBlocks: { c1: { lang: "text", code: "a\nb" } },
  chapters: [
    { id: "ch1", title: "C1", sections: [
      { id: "s1", title: "S1", segments: [seg("a1"), seg("a2", { code: { ref: "c1", highlight: [2, 2] } }), seg("a3")] },
      { id: "s2", title: "S2", segments: [seg("b1")] },
    ] },
    { id: "ch2", title: "C2", sections: [{ id: "s3", title: "S3", segments: [seg("c1"), seg("c2", { visual: { kind: "list", title: "L", ordered: false, items: ["x"] } })] }] },
  ],
};
const flat = flatten(LESSON);
const run = (actions: PlayerAction[], from = initialPlayerState) => actions.reduce((s, a) => playerReducer(s, a, flat), from);

test("flatten: segmenti in ordine, confini di sezione inclusivi", () => {
  assert.equal(flat.segments.length, 6);
  assert.deepEqual(flat.sections.s1, { start: 0, end: 2 });
  assert.deepEqual(flat.order, ["s1", "s2", "s3"]);
});

test("ENDED sull'ultimo segmento di una sezione la segna come completata", () => {
  const s = run([{ type: "PLAY" }, { type: "ENDED" }, { type: "ENDED" }]);
  assert.deepEqual(s.completed, []);
  const done = run([{ type: "ENDED" }], s);
  assert.deepEqual(done.completed, ["s1"]);
  assert.equal(done.index, 3);
  assert.equal(done.revision, s.revision); // in riproduzione il controller avanza da solo
});

test("ENDED da fermo (o a fine lezione) chiede un seek nuovo", () => {
  const paused = run([{ type: "ENDED" }]);
  assert.equal(paused.revision, 1);
  const end = run([{ type: "SEEK_SEGMENT", index: 5 }, { type: "PLAY" }, { type: "ENDED" }]);
  assert.equal(end.playing, false);
  assert.deepEqual(end.completed, ["s3"]);
});

test("saltare una sezione non la completa; MARK_SECTION sì, in ordine di lezione", () => {
  const s = run([{ type: "NEXT_SECTION" }, { type: "NEXT_SECTION" }]);
  assert.equal(s.index, 4);
  assert.deepEqual(s.completed, []);
  const marked = run([{ type: "MARK_SECTION", sectionId: "s3" }, { type: "MARK_SECTION", sectionId: "s1" }, { type: "MARK_SECTION", sectionId: "x" }], s);
  assert.deepEqual(marked.completed, ["s1", "s3"]);
});

test("PREV_SECTION: a metà sezione torna all'inizio, dall'inizio va alla precedente", () => {
  assert.equal(run([{ type: "SEEK_SEGMENT", index: 2 }, { type: "PREV_SECTION" }]).index, 0);
  assert.equal(run([{ type: "SEEK_SEGMENT", index: 3 }, { type: "PREV_SECTION" }]).index, 0);
});

test("RESTORE: posizione, offset limitato alla durata, velocità e sezioni note", () => {
  const s = run([{ type: "RESTORE", segmentId: "b1", offset: 99, rate: 3, completed: ["s1", "boh"] }]);
  assert.equal(s.index, 3);
  assert.equal(s.offset, 10);
  assert.equal(s.rate, 2);
  assert.deepEqual(s.completed, ["s1"]);
  assert.equal(run([{ type: "RESTORE", segmentId: "sparito", offset: 5, rate: 1, completed: [] }]).index, 0);
});

test("panelAt: il codice resta visibile sui segmenti successivi della sezione", () => {
  const s1 = LESSON.chapters[0].sections[0];
  assert.deepEqual(panelAt(s1, 0), { kind: "empty" });
  assert.deepEqual(panelAt(s1, 2), { kind: "code", ref: "c1", highlight: [2, 2] });
  assert.equal(panelAt(LESSON.chapters[1].sections[0], 1).kind, "visual");
});

test("timeline: secondi prima del segmento e totale", () => {
  assert.deepEqual(timeline(flat, 3), { before: 30, total: 60 });
});
