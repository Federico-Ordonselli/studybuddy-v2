import Link from "next/link";
import { SF6_ROSTER, SF6_ARCHETYPE_COLORS } from "@/lib/sf6/roster";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { comboCounts, recentCombos } from "@/lib/sf6/store";
import { notesForModule } from "@/lib/notes";
import { NotationRenderer } from "@/components/sf6/notation-renderer";

export const dynamic = "force-dynamic";

export default function Sf6HomePage() {
  const counts = comboCounts();
  const recent = recentCombos(5);
  const sf6Notes = notesForModule("sf6", 5);

  // Group roster by year
  const byYear = {
    0: SF6_ROSTER.filter((c) => c.year === 0),
    1: SF6_ROSTER.filter((c) => c.year === 1),
    2: SF6_ROSTER.filter((c) => c.year === 2),
    3: SF6_ROSTER.filter((c) => c.year === 3),
  };

  const totalCombos = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-5xl mx-auto px-8 md:px-12 py-14">
      {/* Header */}
      <header className="mb-14 fade-up">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="text-5xl text-[var(--color-accent)] leading-none">✦</span>
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
            dominio · fighting game
          </div>
        </div>
        <h1
          className="text-5xl md:text-6xl leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
        >
          Street Fighter <em className="italic text-[var(--color-accent)] font-light">6</em>
        </h1>
        <div className="mt-4 flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          <span>
            <span className="font-[var(--font-mono)] tabular normal-case tracking-normal text-[var(--color-fg-muted)]">{SF6_ROSTER.length}</span>{" "}
            personaggi
          </span>
          <span className="text-[var(--color-border-strong)]">·</span>
          <span>
            <span className="font-[var(--font-mono)] tabular normal-case tracking-normal text-[var(--color-fg-muted)]">{totalCombos}</span>{" "}
            combo nel tuo repertorio
          </span>
        </div>
      </header>

      {/* Recent combos */}
      {recent.length > 0 && (
        <section className="mb-14 fade-up" style={{ animationDelay: "100ms" }}>
          <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-3">
            Aggiunte di recente
          </h2>
          <ul className="space-y-2">
            {recent.map((c) => {
              const char = SF6_ROSTER.find((x) => x.slug === c.characterSlug);
              return (
                <li
                  key={c.id}
                  className="border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-4 py-3 flex items-start gap-4"
                >
                  <Link
                    href={`/sf6/${c.characterSlug}`}
                    className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline shrink-0 mt-0.5"
                  >
                    {char?.name ?? c.characterSlug}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <NotationRenderer text={c.notation} size="sm" />
                  </div>
                  <span className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-[0.18em] shrink-0 mt-1">
                    {relativeTime(c.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Fondamentali — domain-wide knowledge */}
      <section className="mb-12 fade-up" style={{ animationDelay: "140ms" }}>
        <Link
          href="/sf6/fondamentali"
          className="group relative block border border-[var(--color-accent)]/30 bg-gradient-to-br from-[var(--color-accent)]/[0.06] to-[var(--color-surface)] rounded-lg px-6 py-5 hover:border-[var(--color-accent)]/60 hover:from-[var(--color-accent)]/[0.10] transition-all"
        >
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3 mb-1.5">
                <span className="text-2xl text-[var(--color-accent)] leading-none">◊</span>
                <h3
                  className="text-xl tracking-tight"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
                >
                  Fondamentali
                </h3>
                <span className="text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)]">
                  trasversale
                </span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--color-fg-muted)] max-w-xl">
                Drive system, neutral, pressione, difesa, mentalità. Conoscenza che resta utile
                cambiando main.
              </p>
            </div>
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)] group-hover:text-[var(--color-accent)] transition-colors shrink-0">
              Apri →
            </span>
          </div>
        </Link>
      </section>

      {/* Roster by year */}
      <section className="mb-14 fade-up" style={{ animationDelay: "180ms" }}>
        <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-3">
          Roster
        </h2>
        <div className="space-y-10">
          {([0, 1, 2, 3] as const).map((year) => {
            const chars = byYear[year];
            if (chars.length === 0) return null;
            const title = year === 0 ? "Base game" : `Year ${year}`;
            return (
              <div key={year}>
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-fg-dim)] mb-3 flex items-baseline gap-3">
                  <span>{title}</span>
                  <span className="font-[var(--font-mono)] tabular normal-case tracking-normal text-[var(--color-fg-dim)]/70">
                    {chars.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {chars.map((c) => {
                    const cnt = counts[c.slug] ?? 0;
                    return (
                      <Link
                        key={c.slug}
                        href={`/sf6/${c.slug}`}
                        className="group relative border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-4 py-3 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] transition-all overflow-hidden"
                      >
                        {/* Archetype side stripe */}
                        <span
                          className="absolute left-0 top-0 bottom-0 w-[3px] opacity-60 group-hover:opacity-100 transition-opacity"
                          style={{ background: SF6_ARCHETYPE_COLORS[c.archetype] }}
                        />
                        <div className="flex items-baseline justify-between">
                          <span className="text-[14.5px] font-medium text-[var(--color-fg)] leading-tight">
                            {c.name}
                          </span>
                          {cnt > 0 && (
                            <span className="text-[10px] font-[var(--font-mono)] tabular text-[var(--color-accent)]">
                              {cnt}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
                          <span style={{ color: SF6_ARCHETYPE_COLORS[c.archetype] }}>
                            {c.archetype}
                          </span>
                          <span className="text-[var(--color-fg-dim)]">·</span>
                          <DifficultyDots difficulty={c.difficulty} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sf6 inbox notes (linked from quick capture) */}
      {sf6Notes.length > 0 && (
        <section className="mt-14 fade-up" style={{ animationDelay: "260ms" }}>
          <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-3">
            Note di dominio
          </h2>
          <ul className="space-y-2">
            {sf6Notes.map((n) => (
              <li
                key={n.id}
                className="border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg px-4 py-3"
              >
                <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
                  {n.content}
                </p>
                <div className="text-[10.5px] text-[var(--color-fg-dim)] uppercase tracking-[0.18em] mt-1.5">
                  <span className="tabular normal-case tracking-normal">
                    {relativeTime(n.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DifficultyDots({ difficulty }: { difficulty: number }) {
  return (
    <span className="flex items-center gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "w-1 h-1 rounded-full",
            i <= difficulty ? "bg-[var(--color-fg-muted)]" : "bg-[var(--color-border-strong)]"
          )}
        />
      ))}
    </span>
  );
}
