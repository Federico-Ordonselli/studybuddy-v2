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
