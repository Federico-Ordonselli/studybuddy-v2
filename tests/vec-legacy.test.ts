import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb } from './helpers/db';
const { sqlite } = await useTempDb();
const { EMBED_DIM } = await import('@/lib/config');
const { initVectorStore } = await import('@/lib/db');
const { indexChunks, vectorSearchByEmbedding } = await import('@/lib/rag/store');
const { ollamaProvider } = await import('@/lib/providers/ollama');
const vector = (n: number) => Array.from({ length: EMBED_DIM }, (_, i) => i ? 0 : n);

test('schema vec precedente: warning unico, ingest e ricerca con post-filtro', async () => {
  sqlite.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${EMBED_DIM}]);
    INSERT INTO domains(id,name,parent_id) VALUES (1,'altro',NULL),(2,'macro',NULL),(3,'figlio',2);
    INSERT INTO documents(id,domain_id,title) VALUES (1,1,'a'),(2,3,'b');`);
  const warnings: string[] = [];
  const warn = console.warn;
  const embed = ollamaProvider.embed;
  console.warn = (message) => warnings.push(String(message));
  ollamaProvider.embed = async (_model, texts) => texts.map((_, i) => vector(i + 1));
  try {
    assert.equal(initVectorStore(), false);
    await indexChunks(1, [{ content: 'altro' }]);
    await indexChunks(2, [{ content: 'figlio' }, { content: 'secondo' }]);
    assert.deepEqual(vectorSearchByEmbedding(vector(0), 1, 2).map(r => r.content), ['figlio']);
    assert.equal(vectorSearchByEmbedding(vector(0), 2, 1).length, 1);
    assert.equal(vectorSearchByEmbedding(vector(0), 1).length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /scripts\/migrate-vec-domain.ts/);
  } finally { console.warn = warn; ollamaProvider.embed = embed; }
});
