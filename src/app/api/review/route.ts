import { NextRequest } from "next/server";
import { dueCount, nextDueCard, reviewCard } from "@/lib/tutor/cards";
import {handle, handleLlm, readJson, badJson} from "@/lib/http";
import {positiveId,text} from "@/lib/validation";
import {LibraryError} from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  return handle(()=>{
    const domainId=positiveId(Number(req.nextUrl.searchParams.get("domainId")),"domainId",true)!;
    return {due:dueCount(domainId),card:nextDueCard(domainId)};
  });
}
export async function POST(req: NextRequest) {
  const body=await readJson(req);if(!body)return badJson();
  return handleLlm(async()=>{
    const cardId=positiveId(body.cardId,"cardId",true)!;
    const answer=text(body.answer,"answer"),domainId=positiveId(body.domainId,"domainId");
    const result=await reviewCard(cardId,answer,domainId);
    if(!result)throw new LibraryError("Carta non trovata",404);
    return result;
  });
}
