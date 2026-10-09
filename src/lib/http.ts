import { NextResponse } from "next/server";
import { LibraryError } from "@/lib/errors";

/** Esegue una mutazione: risultato (o `{ ok: true }`) come JSON, `LibraryError` → `{ error }` con il suo status. */
export function handle(fn: () => unknown) {
  try {
    return NextResponse.json(fn() ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Come `handle`, per le operazioni asincrone lunghe (LLM, trascrizione): gli altri errori → 500 con il messaggio, che la UI mostra. */
export async function handleAsync(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[api]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Corpo JSON come oggetto; null se non è JSON o non è un oggetto. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const b: unknown = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export const badJson = () => NextResponse.json({ error: "JSON non valido" }, { status: 400 });
