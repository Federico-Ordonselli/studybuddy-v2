import {NextRequest} from "next/server";
import {summarizeTopic,summarizeModule} from "@/lib/summarize";
import {handleLlm,readJson,badJson} from "@/lib/http";
import {positiveId,text} from "@/lib/validation";
export const runtime="nodejs";
export async function POST(req:NextRequest) {
  const body=await readJson(req);if(!body)return badJson();
  return handleLlm(async()=>{
    const domainId=positiveId(body.domainId,"domainId",true)!;
    const summary=body.module !== undefined ? await summarizeModule(domainId,text(body.module,"module")) : await summarizeTopic(domainId,text(body.topic,"topic"));
    return {summary};
  });
}
