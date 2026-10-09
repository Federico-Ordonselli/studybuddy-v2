import Link from "next/link";
import { dueByDomain, getShellData, recentCourses } from "@/lib/home";
import { listInbox } from "@/lib/notes";
import { greeting, relativeTime, todayLabel } from "@/lib/format";
import NoteComposer from "@/components/notes/NoteComposer";
import NoteList from "@/components/notes/NoteList";

export const dynamic = "force-dynamic";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xs uppercase tracking-[0.3em] text-fg-dim mb-3">{title}</h2>
      {children}
    </section>
  );
}

/** Home personale: saluto, «Oggi» (ripasso e ultimi corsi), appunto veloce, inbox. Ogni blocco solo se ha contenuto. */
export default function HomePage() {
  const due = dueByDomain();
  const recent = recentCourses();
  const inbox = listInbox();
  const shell = getShellData();
  const name = process.env.STUDYBUDDY_USER_NAME?.trim();
  const now = new Date();

  return (
    <div className="max-w-3xl w-full mx-auto px-4 md:px-8 py-10 md:py-14">
      <header className="mb-12 fade-up">
        <div className="text-[10px] uppercase tracking-[0.3em] text-fg-dim mb-3 tabular">{todayLabel(now)}</div>
        <h1 className="font-display text-5xl md:text-6xl leading-[0.95] tracking-tight">
          {greeting(now.getHours())}{name ? <>, <em className="italic text-accent">{name}</em></> : null}.
        </h1>
      </header>

      {(due.length > 0 || recent.length > 0) && (
        <Block title="Oggi">
          <div className="grid gap-3 sm:grid-cols-2">
            {due.length > 0 && (
              <div className="border border-border bg-surface rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim mb-2">Da ripassare</div>
                <ul className="flex flex-col gap-1">
                  {due.map((d) => (
                    <li key={d.id}>
                      <Link href={`/study/${d.id}?mode=review`} className="flex items-center justify-between gap-3 py-1 hover:text-accent">
                        <span className="truncate">{d.name}</span>
                        <span className="text-accent tabular text-sm">{d.due} {d.due === 1 ? "carta" : "carte"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {recent.length > 0 && (
              <div className="border border-border bg-surface rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-[0.25em] text-fg-dim mb-2">Riprendi</div>
                <ul className="flex flex-col gap-1">
                  {recent.map((r) => (
                    <li key={r.id}>
                      <Link href={`/study/${r.id}?mode=tutor`} className="flex items-center justify-between gap-3 py-1 hover:text-accent">
                        <span className="truncate">{r.name}</span>
                        <time dateTime={r.lastAt} className="text-fg-dim text-xs tabular">{relativeTime(r.lastAt, now)}</time>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Block>
      )}

      <Block title="Appunto">
        <NoteComposer areas={shell.areas} courses={shell.courses} initial={{ kind: "inbox" }} />
      </Block>

      {inbox.length > 0 && (
        <Block title={`Inbox · ${shell.inboxCount}`}>
          <NoteList notes={inbox} areas={shell.areas} showWhere={false} movable />
        </Block>
      )}

      {!due.length && !recent.length && !inbox.length && (
        <p className="text-sm text-fg-dim">
          Niente in sospeso. Apri i <Link href="/corsi" className="text-accent underline">corsi</Link> o prendi un appunto (tasto <kbd className="font-mono">n</kbd>).
        </p>
      )}
    </div>
  );
}
