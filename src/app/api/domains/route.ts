import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { domains, documents } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Elenco dei domini con il numero di documenti, per il selettore in UI.
 * Ordine: ogni dominio di primo livello seguito dai suoi figli. Un `macro` conta anche
 * i documenti dei figli, come fa lo scope del retrieval (`resolveScope` in rag/store.ts).
 */
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

  const ordered: typeof rows = [];
  for (const top of rows.filter((d) => d.parentId == null)) {
    const kids = rows.filter((d) => d.parentId === top.id);
    ordered.push({ ...top, docs: top.docs + kids.reduce((n, k) => n + k.docs, 0) }, ...kids);
  }
  // figli di un genitore sparito: non devono scomparire dal selettore
  ordered.push(...rows.filter((d) => !ordered.some((o) => o.id === d.id)));
  return NextResponse.json({ domains: ordered });
}
