import Link from "next/link";
import { listLessons } from "@/lib/studio";
import { formatDuration } from "@/lib/client/studioPlayer";
import type { StudioLessonSummary } from "@/lib/studioTypes";

export const dynamic = "force-dynamic";

/** Full Studio: le lezioni audio dei corsi, raggruppate per corso, con avanzamento e carte sbloccate. */
export default function FullStudioPage() {
  const lessons = listLessons();
  const groups = new Map<string, StudioLessonSummary[]>();
  for (const l of lessons) {
    const key = l.parentName ? `${l.parentName} · ${l.courseName}` : l.courseName;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return (
    <div className="max-w-4xl w-full mx-auto px-4 md:px-8 py-10 flex flex-col gap-10">
      <header className="fade-up">
        <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-2">Full Studio</div>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-none">Lezioni da ascoltare</h1>
        <p className="mt-3 text-fg-muted max-w-2xl">
          Ascolta una lezione e, a ogni sezione finita, le sue carte entrano nel ripasso e le sue domande nel quiz.
        </p>
      </header>

      {!lessons.length && (
        <section className="rounded-lg border border-border bg-surface p-6 text-fg-muted">
          <p className="text-fg">Nessuna lezione audio ancora.</p>
          <p className="mt-2">
            Prepara un pacchetto con <code>npm run prepare:full-studio</code> nella cartella di un corso
            (<code>&lt;modulo&gt;/studio/lesson.json</code>), poi importa il corso da{" "}
            <Link href="/corsi/add" className="text-accent underline">Corsi → Aggiungi</Link>.
          </p>
        </section>
      )}

      {[...groups].map(([course, items]) => (
        <section key={course} className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-fg-dim">{course}</h2>
          <ul className="flex flex-col gap-2">
            {items.map((l) => {
              const pct = l.sections ? Math.round((l.completed / l.sections) * 100) : 0;
              return (
                <li key={l.id}>
                  <Link href={`/full-studio/${l.id}`}
                    className="block rounded-lg border border-border bg-surface hover:bg-raised px-5 py-4 transition-colors">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-display text-xl tracking-tight">{l.title}</span>
                      <span className="text-xs text-fg-dim tabular-nums whitespace-nowrap">{formatDuration(l.duration)}</span>
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden>
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
                      <span>{l.completed} / {l.sections} sezioni ascoltate</span>
                      {l.cardsTotal > 0 && <span>{l.cardsUnlocked} / {l.cardsTotal} carte sbloccate</span>}
                      {l.quiz > 0 && <span>{l.quiz} domande di quiz</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
