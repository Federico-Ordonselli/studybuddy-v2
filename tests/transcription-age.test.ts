import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatTranscriptionAge} from '@/lib/sf6/sources';
test('età trascrizione: secondi, minuti trascorsi e resto',()=>{
 assert.equal(formatTranscriptionAge(4000),'4 s');
 assert.equal(formatTranscriptionAge(59999),'59 s');
 assert.equal(formatTranscriptionAge(60000),'1 min');
 assert.equal(formatTranscriptionAge(91000),'1 min 31 s');
});
