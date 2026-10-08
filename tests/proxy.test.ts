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
