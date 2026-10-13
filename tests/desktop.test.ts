import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { quitFilePath, requestQuit } from "@/lib/desktop";

// Il launcher (scripts/desktop/launch.sh) cerca il file in ./data, accanto al DB.
test("il file di chiusura sta nella cartella del DB", () => {
  assert.equal(quitFilePath("/app/data/studybuddy.db"), "/app/data/.desktop-quit");
  assert.equal(quitFilePath("data/studybuddy.db"), path.resolve("data/.desktop-quit"));
});

test("requestQuit scrive il file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-desktop-"));
  try {
    requestQuit(path.join(dir, "x.db"));
    assert.ok(fs.existsSync(path.join(dir, ".desktop-quit")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
