import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useTempDb} from './helpers/db';
const {sqlite}=await useTempDb();
const {listCards,updateCard,deleteCard,suspendCard,dueCount,nextDueCard,isDuplicateQuestion,sourceForAnswer}=await import('@/lib/tutor/cards');
sqlite.exec("INSERT INTO domains(id,name) VALUES(1,'macro'),(2,'figlio'),(3,'altro');UPDATE domains SET parent_id=1 WHERE id=2; INSERT INTO cards(id,domain_id,question,answer,due_at) VALUES(1,2,'domanda','risposta',0),(2,3,'altra','altra risposta',0)");
test('list/update/suspend/unsuspend/delete: scope e coda SM-2',()=>{
 assert.equal(listCards(1).length,1);assert.equal(listCards(1,'due').length,1);
 assert.equal(updateCard(1,{question:'nuova domanda',answer:'nuova risposta'})?.answer,'nuova risposta');
 assert.throws(()=>updateCard(1,{question:' ',answer:'ok'}));
 suspendCard(1,true);assert.equal(dueCount(1),0);assert.equal(nextDueCard(1),null);assert.equal(listCards(1).length,1);assert.equal(listCards(1,'due').length,0);
 suspendCard(1,false);assert.equal(dueCount(1),1);deleteCard(1);assert.equal(listCards(1).length,0);assert.throws(()=>deleteCard(999));
});
test('dedup domande e attribuzione lessicale della risposta',()=>{
 assert.ok(isDuplicateQuestion('Qual è il principio di base?', ['QUAL è il principio di base!']));
 assert.ok(isDuplicateQuestion('uno due tre quattro cinque sei sette otto', ['uno due tre quattro cinque sei sette otto nove']));
 assert.equal(isDuplicateQuestion('domanda diversa', ['come funziona questo sistema']),false);
 assert.equal(sourceForAnswer('gatto sul divano',[{chunkId:1,content:'astronomia stelle galassie'},{chunkId:2,content:'gatto sul divano'}]),2);
});

test('dal quiz al ripasso: dominio, contenuto, dedup e nessuna carta in altri corsi', async()=>{
 const {createCardFromQuiz}=await import('@/lib/tutor/cards');
 const result=createCardFromQuiz(2,{question:'Come funziona il ripasso?',answer:'Con intervalli progressivi'});
 assert.ok(result.created);assert.equal(result.card?.domainId,2);assert.equal(result.card?.answer,'Con intervalli progressivi');
 assert.equal(createCardFromQuiz(2,{question:'Come funziona il ripasso?',answer:'Con intervalli progressivi'}).created,false);
 assert.throws(()=>createCardFromQuiz(999,{question:'q',answer:'a'}));
});
