import { MODULES, type ModuleInfo } from "@/lib/modules";

/**
 * Dove va un appunto preso dalla pagina corrente (quick capture): sullo studio di un
 * corso → il corso; su /d/[slug] o sulle route di un modulo → quel dominio; altrove →
 * inbox. Puro: lo usano la shell (client) e i test.
 */
export type CaptureTarget = { kind: "inbox" } | { kind: "area"; slug: string } | { kind: "course"; id: number };

export function captureTarget(
  pathname: string,
  areas: { slug: string; module: string | null }[],
  modules: Record<string, ModuleInfo> = MODULES,
): CaptureTarget {
  const study = /^\/study\/(\d+)(?:\/|$)/.exec(pathname);
  if (study) return { kind: "course", id: Number(study[1]) };
  const d = /^\/d\/([^/]+)/.exec(pathname);
  if (d) {
    const slug = decodeURIComponent(d[1]);
    return areas.some((a) => a.slug === slug) ? { kind: "area", slug } : { kind: "inbox" };
  }
  for (const a of areas) {
    const href = a.module && Object.hasOwn(modules, a.module) ? modules[a.module].href : undefined;
    if (href && (pathname === href || pathname.startsWith(`${href}/`))) return { kind: "area", slug: a.slug };
  }
  return { kind: "inbox" };
}

/** Corpo di POST /api/notes per una destinazione. */
export function noteBody(content: string, t: CaptureTarget) {
  return { content, domain: t.kind === "area" ? t.slug : null, courseId: t.kind === "course" ? t.id : null };
}

/** Apre la quick capture da qualsiasi componente (la shell ascolta questo evento). */
export const CAPTURE_EVENT = "studybuddy:capture";
export const openCapture = () => window.dispatchEvent(new Event(CAPTURE_EVENT));
