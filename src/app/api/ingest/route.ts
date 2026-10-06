import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { indexChunks } from "@/lib/rag/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { domainId, title, source, text } = await req.json();
  if (!text || !title) {
    return NextResponse.json({ error: "title e text richiesti" }, { status: 400 });
  }
  const [doc] = await db
    .insert(documents)
    .values({ domainId, title, source, kind: "text" })
    .returning({ id: documents.id });

  const records = chunkText(text).map((content) => ({ content }));
  await indexChunks(doc.id, records);

  return NextResponse.json({ documentId: doc.id, chunks: records.length });
}
