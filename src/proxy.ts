import { NextRequest, NextResponse } from "next/server";

/**
 * Difese minime per un'app locale che espone il filesystem (browser cartelle,
 * ingestione, video):
 *
 * 1. Host allowlist (DNS rebinding + LAN): un dominio dell'attaccante può risolvere
 *    a 127.0.0.1 e diventare "same-origin", leggendo anche le risposte; e `next dev`
 *    ascolta su tutte le interfacce. Si accettano solo host locali, più quelli in
 *    STUDYBUDDY_ALLOWED_HOSTS (es. "192.168.1.10,studybuddy.lan") per l'uso in LAN.
 * 2. JSON-only sulle scritture (CSRF): con `Content-Type: text/plain` un POST
 *    cross-site è "simple" (niente preflight) e `req.json()` lo parserebbe lo stesso.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EXTRA_HOSTS = new Set(
  (process.env.STUDYBUDDY_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
);

function hostAllowed(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, ""); // toglie la porta ([::1]:3000 → [::1])
  return LOCAL_HOSTS.has(host) || EXTRA_HOSTS.has(host);
}

export function proxy(req: NextRequest) {
  if (!hostAllowed(req.headers.get("host"))) {
    return NextResponse.json({ error: "host non consentito" }, { status: 403 });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "Content-Type application/json richiesto" }, { status: 415 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
