import { sqlite } from "@/lib/db";
import { ollamaBaseUrl } from "@/lib/providers/ollama";
import { rerankerState, warmReranker, type RerankerState } from "@/lib/rag/reranker";
import { whisperAvailable } from "@/lib/transcribe";

export interface Health {
  ok: boolean; // db.ok && ollama.ok
  db: { ok: boolean; error?: string };
  ollama: { ok: boolean; url: string; models?: string[]; error?: string };
  reranker: RerankerState;
  whisper: { available: boolean };
}

const msg = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

function checkDb(): Health["db"] {
  try {
    sqlite.prepare("SELECT count(*) FROM domains").get();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

async function checkOllama(): Promise<Health["ollama"]> {
  const url = ollamaBaseUrl();
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, url, error: `HTTP ${r.status}` };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { ok: true, url, models: (j.models ?? []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, url, error: msg(e) };
  }
}

/** Stato dei pezzi che servono all'app. `warm` carica il reranker (GPU o CPU) prima di rispondere. */
export async function getHealth(opts: { warm?: boolean } = {}): Promise<Health> {
  if (opts.warm) await warmReranker().catch(() => {}); // l'errore resta in rerankerState()
  const db = checkDb();
  const ollama = await checkOllama();
  return { ok: db.ok && ollama.ok, db, ollama, reranker: rerankerState(), whisper: { available: whisperAvailable() } };
}
