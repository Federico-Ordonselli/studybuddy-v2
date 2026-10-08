import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, post } from "@/lib/client/api";

test("ApiError tiene il body della risposta (es. `skipped` di un 422)", async () => {
  const body = { error: "nessun materiale importabile in questa cartella", skipped: [{ name: "rotto", reason: "link simbolico rotto" }] };
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 422 });
  const err = await post("/api/x", {}).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 422);
  assert.equal(err.message, body.error);
  assert.deepEqual(err.body, body);
});
