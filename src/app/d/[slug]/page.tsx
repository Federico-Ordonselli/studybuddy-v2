import Link from "next/link";
import { notFound } from "next/navigation";
import { findArea } from "@/lib/areas";
import { getLibrary } from "@/lib/library";
import { getShellData } from "@/lib/home";
import { listForArea } from "@/lib/notes";
import { MODULES } from "@/lib/modules";
import { CourseCard, MacroCard } from "@/components/library/LibraryCards";
import NoteComposer from "@/components/notes/NoteComposer";
import NoteList from "@/components/notes/NoteList";

export const dynamic = "force-dynamic";

/** Pagina di un dominio: intestazione, corsi del dominio, modulo (se c'è), note del dominio e dei suoi corsi. */
export default async function AreaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const area = findArea(slug);
  if (!area) notFound();
  const library = getLibrary();
  const macros = library.macros.filter((m) => m.areas.includes(slug));
  const loose = library.loose.filter((c) => c.areas.includes(slug));
  const notes = listForArea(slug);
  const shell = getShellData();
  const mod = area.module && Object.hasOwn(MODULES, area.module) ? MODULES[area.module] : undefined;

  return (
    <div className="max-w-5xl w-full mx-auto px-4 md:px-8 py-10">
      <header className="mb-10 fade-up">
        <div className="flex items-baseline gap-4 mb-2">
          <span className="text-5xl text-accent leading-none">{area.symbol}</span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-fg-dim">Dominio</span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-none">{area.name}</h1>
        {area.tagline && <p className="mt-3 text-fg-muted">{area.tagline}</p>}
        {mod && <Link href={mod.href} className="inline-block mt-4 bg-accent text-bg rounded-md px-3 py-1.5 text-sm font-medium">Apri {mod.title} →</Link>}
      </header>

      {(macros.length > 0 || loose.length > 0) && (
        <section className="mb-10">
          <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">Corsi</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {macros.map((m) => <MacroCard key={`m${m.id}`} m={m} library={library} />)}
            {loose.map((c) => <CourseCard key={`c${c.id}`} c={c} library={library} />)}
          </div>
        </section>
      )}

      <section className="mb-10 max-w-3xl">
        <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">Appunto</h2>
        <NoteComposer areas={shell.areas} courses={shell.courses} initial={{ kind: "area", slug }} />
      </section>

      {notes.length > 0 && (
        <section className="max-w-3xl">
          <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">Note · {notes.length}</h2>
          <NoteList notes={notes} areas={shell.areas} />
        </section>
      )}
    </div>
  );
}
