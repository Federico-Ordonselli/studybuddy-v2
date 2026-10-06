import { NextRequest, NextResponse } from "next/server";

/**
 * Protezione CSRF minima per un'app locale: una pagina web qualsiasi aperta nel
 * browser può fare POST a localhost. Con `Content-Type: text/plain` la richiesta
 * è "simple" (niente preflight CORS) e `req.json()` la parserebbe lo stesso.
 * Pretendendo application/json, il browser deve fare un preflight cross-origin,
 * che Next non autorizza → la richiesta di un altro sito non parte.
 */
export function middleware(req: NextRequest) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "Content-Type application/json richiesto" }, { status: 415 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
