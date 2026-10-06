import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { domains, documents } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Elenco dei domini con il numero di documenti, per il selettore in UI. */
export async function GET() {
  const rows = await db
    .select({
      id: domains.id,
      name: domains.name,
      kind: domains.kind,
      parentId: domains.parentId,
      docs: sql<number>`count(${documents.id})`,
    })
    .from(domains)
    .leftJoin(documents, sql`${documents.domainId} = ${domains.id}`)
    .groupBy(domains.id);
  return NextResponse.json({ domains: rows });
}
