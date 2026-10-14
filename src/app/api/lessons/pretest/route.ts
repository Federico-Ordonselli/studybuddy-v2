import { startPretest, revealPretest } from "@/lib/lessonStudy";
import { handleLlm, readJson, badJson } from "@/lib/http";
import { positiveId } from "@/lib/validation";
import { LibraryError } from "@/lib/errors";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const body = await readJson(req); if (!body) return badJson();
  return handleLlm(async () => {
    const domainId = positiveId(body.domainId, "domainId", true)!;
    const documentId = positiveId(body.documentId, "documentId", true)!;
    if (body.action === "start") return startPretest(domainId, documentId);
    if (body.action === "reveal") return revealPretest(domainId, documentId, body.revision, body.answers);
    throw new LibraryError("Azione non valida");
  });
}
