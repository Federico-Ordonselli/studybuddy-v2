import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

test("proxy: copre anche le pagine (Libreria, studio), non gli asset statici", () => {
  for (const url of ["/", "/study/1", "/add", "/api/library"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  }
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/_next/static/chunks/a.js" }), false);
});

test("proxy: host non locale ⇒ 403 anche sulla Libreria (DNS rebinding)", () => {
  const r = proxy(new NextRequest("http://evil.example:3000/", { headers: { host: "evil.example:3000" } }));
  assert.equal(r.status, 403);
  const ok = proxy(new NextRequest("http://localhost:3000/study/1", { headers: { host: "localhost:3000" } }));
  assert.equal(ok.headers.get("x-middleware-next"), "1");
});

test("proxy: /api/sf6/upload escluso (il proxy bufferizzerebbe e troncherebbe il corpo oltre 10 MB), il resto no", () => {
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/api/sf6/upload" }), false);
  for (const url of ["/api/sf6/combos", "/api/sf6/uploadx", "/api/sf6/upload/altro", "/sf6"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  }
});

test("proxy: multipart su qualsiasi altra route API ⇒ 415", () => {
  const form = new FormData();
  form.append("file", new Blob(["x"]), "a.mp3");
  const r = proxy(new NextRequest("http://localhost:3000/api/sf6/combos", { method: "POST", body: form, headers: { host: "localhost:3000" } }));
  assert.equal(r.status, 415);
});
