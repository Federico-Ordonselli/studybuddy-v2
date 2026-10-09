import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug, SLUG_RE } from "@/lib/slug";

test("slugify: minuscole, accenti tolti, separatori come trattino", () => {
  assert.equal(slugify("Web"), "web");
  assert.equal(slugify("  Data  Science "), "data-science");
  assert.equal(slugify("Società & Cultura"), "societa-cultura");
  assert.equal(slugify("C++"), "c");
  assert.equal(slugify("★★"), "dominio"); // niente di utilizzabile
  assert.ok(slugify("x".repeat(100)).length <= 40);
  for (const n of ["Web", "Società & Cultura", "C++", "★★", "a---b", "-x-"]) assert.match(slugify(n), SLUG_RE);
});

test("uniqueSlug: suffisso -2, -3… se già preso", () => {
  assert.equal(uniqueSlug("c", new Set()), "c");
  assert.equal(uniqueSlug("c", new Set(["c"])), "c-2");
  assert.equal(uniqueSlug("c", new Set(["c", "c-2"])), "c-3");
});
