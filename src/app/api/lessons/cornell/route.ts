import { NextRequest } from "next/server";
import { getCornell, startCornell, saveCornell, checkCornell, cornellCard } from "@/lib/lessonStudy";
import { handle, handleLlm, readJson, badJson } from "@/lib/http";
import { positiveId } from "@/lib/validation";
import { LibraryError } from "@/lib/errors";

export const runtime = "nodejs";
export function GET(req: NextRequest) {
  return handle(() => ({ work: getCornell(
    positiveId(Number(req.nextUrl.searchParams.get("domainId")), "domainId", true)!,
    positiveId(Number(req.nextUrl.searchParams.get("documentId")), "documentId", true)!) }));
}
export async function POST(req: NextRequest) {
  const body = await readJson(req); if (!body) return badJson();
  return handleLlm(async () => {
    const domainId = positiveId(body.domainId, "domainId", true)!;
    const documentId = positiveId(body.documentId, "documentId", true)!;
    switch (body.action) {
      case "start": return { work: await startCornell(domainId, documentId) };
      case "save": return { work: saveCornell(domainId, documentId, body.revision, body.answers, body.summary) };
      case "check": return { work: await checkCornell(domainId, documentId, body.revision, body.answers, body.summary) };
      case "card": return { card: cornellCard(domainId, documentId, body.revision, body.index) };
      default: throw new LibraryError("Azione non valida");
    }
  });
}
