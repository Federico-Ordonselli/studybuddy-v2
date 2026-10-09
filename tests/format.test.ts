import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime, greeting, todayLabel } from "@/lib/format";

const now = new Date("2026-10-09T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

test("relativeTime: ora, minuti, ore, giorni, poi la data", () => {
  assert.equal(relativeTime(ago(10_000), now), "ora");
  assert.equal(relativeTime(ago(5 * 60_000), now), "5 min fa");
  assert.equal(relativeTime(ago(3 * 3_600_000), now), "3 h fa");
  assert.equal(relativeTime(ago(2 * 86_400_000), now), "2 g fa");
  assert.match(relativeTime(ago(30 * 86_400_000), now), /^\d{1,2} \S+$/); // es. "9 set"
  assert.equal(relativeTime(ago(-60_000), now), "ora"); // orologio un po' avanti: niente "-1 min"
});

test("greeting: fasce orarie", () => {
  assert.equal(greeting(3), "Buonanotte");
  assert.equal(greeting(6), "Buongiorno");
  assert.equal(greeting(11), "Buongiorno");
  assert.equal(greeting(12), "Buon pomeriggio");
  assert.equal(greeting(18), "Buonasera");
  assert.equal(greeting(23), "Buonasera");
});

test("todayLabel: giorno della settimana, giorno e mese in italiano", () => {
  assert.equal(todayLabel(new Date(2026, 9, 9)), "venerdì 9 ottobre");
});
