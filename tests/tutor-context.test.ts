import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb } from './helpers/db';
await useTempDb();
const { forModel, appendTurn } = await import('@/lib/tutor/sessions');
const { buildRetrievalQuery } = await import('@/lib/tutor/session');
test('forModel limita turni e caratteri senza modificare la cronologia completa', () => {
  let history = appendTurn([], 'prima', 'risposta', []);
  history = appendTurn(history, 'seconda', 'seguito', []);
  const original = JSON.stringify(history);
  assert.deepEqual(forModel(history, 1), [{role:'user',content:'seconda'},{role:'assistant',content:'seguito'}]);
  assert.ok(forModel(history, 8, 10).reduce((n,m)=>n+m.content.length,0) <= 10);
  assert.deepEqual(forModel(history, 0), []);
  assert.equal(JSON.stringify(history), original);
});
test('retrieval include domanda precedente e risposta breve nei seguiti', () => {
  assert.equal(buildRetrievalQuery([], 'perché?'), 'perché?');
  assert.equal(buildRetrievalQuery([{role:'user',content:'argomento'},{role:'assistant',content:'spiegazione lunga'}], 'perché?', 5), 'argom\nspieg\nperché?');
});
