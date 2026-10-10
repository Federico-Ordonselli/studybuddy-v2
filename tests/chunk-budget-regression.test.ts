import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chunkText,chunkTranscript} from '@/lib/rag/chunk';
import {rag} from '@/lib/config';
test('regressione: overlap e separatore non superano il budget dei chunk',()=>{
 const result=chunkText('a'.repeat(10000));
 assert.ok(result.length>1);assert.ok(result.every(c=>c.length<=rag.chunkTokens*4));
});
test('regressione: un singolo cue lungo viene spezzato conservando i timestamp',()=>{
 const result=chunkTranscript([{text:'a'.repeat(10000),startSec:120,endSec:150}]);
 assert.ok(result.length>1);assert.ok(result.every(c=>c.content.length<=rag.chunkTokens*4));
 assert.ok(result.every(c=>c.meta?.startSec===120 && c.meta?.endSec===150));
 assert.equal(result.map(c=>c.content).join(''),'a'.repeat(10000));
});
