import type { Verdict } from "@/lib/tutor/grade";

/**
 * Ollama finto. `/api/chat` restituisce `replies` in ordine (l'ultima si ripete); ogni altra
 * chiamata (es. `/api/embed` del retrieve) risponde 503, come un Ollama senza modello di embedding.
 * I corpi delle chiamate chat finiscono in `bodies`.
 */
export async function withJudge<T>(replies: string[], fn: () => Promise<T>, bodies: Record<string, unknown>[] = []): Promise<T> {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/api/chat")) return new Response("offline", { status: 503 });
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ message: { content: replies[Math.min(i++, replies.length - 1)] } });
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

/** Giudizio ben formato con il verdetto dato; `extra` sovrascrive i campi. */
export const verdictJson = (verdict: Verdict, extra: Record<string, unknown> = {}) => JSON.stringify({
  required: ["l'idea centrale"], present: verdict === "wrong" ? [] : ["l'idea centrale"],
  missing: [], errors: [], verdict, feedback: "ok", ...extra,
});
