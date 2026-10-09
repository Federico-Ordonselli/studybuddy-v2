import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// File a sé: "@/lib/db" apre DB_PATH all'import, una volta per processo.
test("health: DB che non si apre ⇒ db.ok:false con errore, niente eccezione (la route risponde 503)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-nodb-"));
  process.env.DB_PATH = path.join(dir, "manca", "test.db"); // cartella inesistente: better-sqlite3 lancia
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // irrilevante qui, basta che non blocchi
  const H = await import("@/lib/health");
  const h = await H.getHealth();
  assert.equal(h.db.ok, false);
  assert.ok(h.db.error && h.db.error.length > 0);
  assert.equal(h.ok, false);
});
