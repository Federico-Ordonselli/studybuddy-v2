/**
 * Controlli sulle richieste di un'app locale che espone il filesystem (vedi src/proxy.ts).
 * `hostAllowed`: solo host locali (DNS rebinding, LAN) più STUDYBUDDY_ALLOWED_HOSTS.
 * `uploadRejection`: l'unica eccezione al vincolo JSON, l'upload multipart dei VOD SF6.
 * Un form cross-site può mandare multipart senza preflight, ma non un `Origin` locale.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EXTRA_HOSTS = new Set(
  (process.env.STUDYBUDDY_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
);

export function hostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, ""); // toglie la porta ([::1]:3000 → [::1])
  return LOCAL_HOSTS.has(host) || EXTRA_HOSTS.has(host);
}

/** null = upload accettabile; altrimenti status ed errore da restituire. */
export function uploadRejection(req: Request): { status: number; error: string } | null {
  const host = req.headers.get("host");
  if (!host || !hostAllowed(host)) return { status: 403, error: "host non consentito" };
  let originHost: string | null = null;
  try {
    const o = req.headers.get("origin");
    originHost = o ? new URL(o).host.toLowerCase() : null;
  } catch { /* Origin malformata (anche "null") */ }
  if (originHost !== host.toLowerCase()) return { status: 403, error: "origine non consentita" };
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return { status: 415, error: "Content-Type multipart/form-data richiesto" };
  }
  return null;
}
