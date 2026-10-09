import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { uploadRejection } from "@/lib/requestGuard";

const up = fs.mkdtempSync(path.join(os.tmpdir(), "sb-upload-"));
process.env.STUDYBUDDY_UPLOAD_DIR = up;
let POST: typeof import("@/app/api/sf6/upload/route").POST;
before(async () => { ({ POST } = await import("@/app/api/sf6/upload/route")); });

const req = (headers: Record<string, string>, body?: FormData) =>
  new NextRequest("http://localhost:3000/api/sf6/upload", { method: "POST", body: body ?? new FormData(), headers: { host: "localhost:3000", ...headers } });
const form = (bytes: Buffer, name: string) => { const f = new FormData(); f.append("file", new File([new Uint8Array(bytes)], name)); return f; };

test("uploadRejection: host locale, Origin dello stesso host, multipart", () => {
  assert.equal(uploadRejection(req({ origin: "http://localhost:3000" })), null);
  assert.deepEqual(uploadRejection(req({})), { status: 403, error: "origine non consentita" });
  assert.equal(uploadRejection(req({ origin: "https://evil.example" }))?.status, 403);
  assert.equal(uploadRejection(req({ origin: "null" }))?.status, 403);
  assert.equal(uploadRejection(req({ origin: "http://localhost:3001" }))?.status, 403);
  assert.equal(uploadRejection(req({ host: "evil.example:3000", origin: "http://evil.example:3000" }))?.status, 403);
  const json = new NextRequest("http://localhost:3000/api/sf6/upload", { method: "POST", body: "{}", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" } });
  assert.equal(uploadRejection(json)?.status, 415);
});

test("POST /api/sf6/upload: 12 MB arrivano interi su disco", async () => {
  const bytes = Buffer.alloc(12 * 1024 * 1024, 3);
  bytes[bytes.length - 1] = 9;
  const r = await POST(req({ origin: "http://localhost:3000" }, form(bytes, "vod.mp4")));
  assert.equal(r.status, 200);
  const j = (await r.json()) as { upload_id: string; size_mb: number };
  assert.equal(j.size_mb, 12);
  const saved = fs.readFileSync(path.join(up, j.upload_id));
  assert.equal(saved.length, bytes.length);
  assert.equal(saved[saved.length - 1], 9);
});

test("POST /api/sf6/upload: Origin estranea 403, estensione sbagliata 400, campo mancante 400", async () => {
  assert.equal((await POST(req({ origin: "https://evil.example" }, form(Buffer.from("x"), "a.mp3")))).status, 403);
  assert.equal((await POST(req({ origin: "http://localhost:3000" }, form(Buffer.from("x"), "a.exe")))).status, 400);
  const r = await POST(req({ origin: "http://localhost:3000" }, new FormData()));
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /file/);
});
