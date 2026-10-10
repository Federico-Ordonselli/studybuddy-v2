import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb } from './helpers/db';
await useTempDb();
const { dedupChunks } = await import('@/lib/rag/pipeline');
const chunk = (id: number, content: string, docKind = 'pdf') => ({chunkId:id, documentId:id, content, docKind, distance:0});
test('dedup: identici e normalizzati', () => {
  assert.equal(dedupChunks([chunk(1,'Un concetto molto importante'),chunk(2,'UN concetto molto importante!')]).length, 1);
});
test('dedup: quasi identici e diversi', () => {
  const a = chunk(1,'uno due tre quattro cinque sei sette otto nove dieci');
  assert.equal(dedupChunks([a,chunk(2,a.content+' undici')]).length,1);
  assert.equal(dedupChunks([a,chunk(3,'il gatto dorme sopra il divano')]).length,2);
  assert.equal(dedupChunks([chunk(4,''),chunk(5,'')]).length,2);
});
test('dedup preferisce transcript mantenendo la posizione e gli altri risultati', () => {
  const a = chunk(1,'uno due tre quattro');
  const t = chunk(3,a.content,'transcript');
  assert.deepEqual(dedupChunks([a,chunk(2,'testo completamente diverso qui'),t]).map(c=>c.chunkId), [3,2]);
  assert.deepEqual(dedupChunks([t,a]), [t]);
});
