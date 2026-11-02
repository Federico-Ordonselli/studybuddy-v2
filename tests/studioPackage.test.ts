import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTree } from "./helpers/fs";
import { publishStudioPackage } from "@/lib/importers/studioPackage";

const LESSON = {
  part: 7, title: "Cap", subtitle: "", codeBlocks: {},
  chapters: [{ id: "p7-ch01", title: "A", sections: [{ id: "p7-ch01-s01", title: "S", segments: [
    { id: "p7-ch01-s01-001", text: "uno", audio: "audio/part7/p7-ch01-s01-001.mp3", duration: 1 },
    { id: "p7-ch01-s01-002", text: "due", audio: "audio/part7/p7-ch01-s01-002.mp3", duration: 1 },
  ] }] }],
};
const STUDY = { version: 1, sections: { "p7-ch01-s01": { cards: [{ q: "Domanda?", a: "Risposta." }], quiz: [{ q: "Q", options: ["a", "b"], answer: 1, why: "" }] } } };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pkg-"));
  makeTree(root, {
    "fs/content/part7/lesson.json": JSON.stringify(LESSON),
    "fs/content/part7/study.json": JSON.stringify(STUDY),
    "fs/app/public/audio/part7/p7-ch01-s01-001.mp3": "mp3",
    "fs/sources/Capitolo.md": "# Cap\n\ntesto",
  });
  return root;
}

test("pubblica studio/ con lezione, carte e audio; il .md accanto al modulo", async () => {
  const root = setup();
  const moduleDir = path.join(root, "lib", "Corso", "01_Cap");
  const r = await publishStudioPackage({ partDir: path.join(root, "fs/content/part7"), studioRoot: path.join(root, "fs"), moduleDir, markdown: path.join(root, "fs/sources/Capitolo.md") });
  assert.deepEqual({ audio: r.audio, missing: r.missingAudio, cards: r.cards, quiz: r.quiz }, { audio: 1, missing: 1, cards: 1, quiz: 1 });
  assert.ok(fs.existsSync(path.join(moduleDir, "studio/lesson.json")));
  assert.ok(fs.existsSync(path.join(moduleDir, "studio/study.json")));
  assert.ok(fs.existsSync(path.join(moduleDir, "studio/audio/part7/p7-ch01-s01-001.mp3")));
  assert.ok(fs.existsSync(path.join(moduleDir, "Capitolo.md")));
  assert.deepEqual(fs.readdirSync(moduleDir).sort(), ["Capitolo.md", "studio"]); // niente staging rimasto
});

test("ripubblicare sostituisce studio/; un .md diverso già presente non si sovrascrive", async () => {
  const root = setup();
  const moduleDir = path.join(root, "lib", "Corso", "01_Cap");
  const opts = { partDir: path.join(root, "fs/content/part7"), studioRoot: path.join(root, "fs"), moduleDir };
  await publishStudioPackage(opts);
  fs.writeFileSync(path.join(moduleDir, "studio/vecchio.txt"), "x");
  await publishStudioPackage(opts);
  assert.ok(!fs.existsSync(path.join(moduleDir, "studio/vecchio.txt")));
  fs.writeFileSync(path.join(moduleDir, "Capitolo.md"), "diverso");
  await assert.rejects(publishStudioPackage({ ...opts, markdown: path.join(root, "fs/sources/Capitolo.md") }), /contenuto diverso/);
  assert.equal(fs.readFileSync(path.join(moduleDir, "Capitolo.md"), "utf8"), "diverso");
});

test("study.json con una sezione sconosciuta: niente pubblicato", async () => {
  const root = setup();
  fs.writeFileSync(path.join(root, "fs/content/part7/study.json"), JSON.stringify({ version: 1, sections: { "p7-ch09-s01": {} } }));
  const moduleDir = path.join(root, "lib", "Corso", "01_Cap");
  await assert.rejects(publishStudioPackage({ partDir: path.join(root, "fs/content/part7"), studioRoot: path.join(root, "fs"), moduleDir }), /sconosciuta/);
  assert.ok(!fs.existsSync(path.join(moduleDir, "studio")));
});
