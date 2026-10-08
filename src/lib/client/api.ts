/**
 * Fetch JSON per il client. Header JSON sempre presente: src/proxy.ts rifiuta le
 * scritture senza `Content-Type: application/json` (anche DELETE).
 */
export class ApiError extends Error {
  /** `body` = la risposta JSON intera: alcuni errori portano dati utili (es. `skipped` col 422). */
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) { super(message); }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new ApiError(j.error ?? `HTTP ${r.status}`, r.status, j);
  return j as T;
}

export const post = <T = unknown>(path: string, body: Record<string, unknown>) => api<T>("POST", path, body);
