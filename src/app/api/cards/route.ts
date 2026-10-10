import { NextRequest } from 'next/server';
import { createCardFromQuiz, generateCards, listCards, updateCard, deleteCard, suspendCard } from '@/lib/tutor/cards';
import { handle, handleLlm, readJson, badJson } from '@/lib/http';
import { positiveId, text } from '@/lib/validation';
import { LibraryError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  return handle(()=>{
    const domainId = positiveId(Number(req.nextUrl.searchParams.get('domainId')),'domainId',true)!;
    const filter = req.nextUrl.searchParams.get('filter') ?? 'all';
    if (filter !== 'all' && filter !== 'due') throw new LibraryError('filter deve essere all o due');
    return {cards:listCards(domainId,filter)};
  });
}
export async function POST(req: NextRequest) {
  const body = await readJson(req); if (!body) return badJson();
  return handleLlm(async()=>{
    const domainId=positiveId(body.domainId,'domainId',true)!;
    if(body.question !== undefined) return createCardFromQuiz(domainId,{question:text(body.question,'question'),answer:text(body.answer,'answer')});
    const topic=text(body.topic,'topic');
    const n=body.n ?? 5;
    if(typeof n !== 'number' || !Number.isInteger(n) || n<1 || n>20) throw new LibraryError('n deve essere un intero tra 1 e 20');
    return generateCards(domainId,topic,n);
  });
}
export async function PATCH(req: NextRequest) {
  const body=await readJson(req);if(!body)return badJson();
  return handle(()=>{
    const id=positiveId(body.id,'id',true)!;
    if (body.suspended !== undefined) {
      if(typeof body.suspended !== 'boolean') throw new LibraryError('suspended deve essere booleano');
      return suspendCard(id,body.suspended);
    }
    return updateCard(id,{question:text(body.question,'question'),answer:text(body.answer,'answer')});
  });
}
export async function DELETE(req: NextRequest) {
  const body=await readJson(req);if(!body)return badJson();
  return handle(()=>deleteCard(positiveId(body.id,'id',true)!));
}
