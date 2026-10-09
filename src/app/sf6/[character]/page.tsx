import Link from "next/link";
import { notFound } from "next/navigation";
import { getSf6Character, SF6_ROSTER, SF6_ARCHETYPE_COLORS } from "@/lib/sf6/roster";
import { ComboList, type ComboRow } from "@/components/sf6/combo-list";
import { TipsList, type TipRow } from "@/components/sf6/tips-list";
import { cn } from "@/lib/cn";
import { listCombos, listTips } from "@/lib/sf6/store";

export const dynamic = "force-dynamic";

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ character: string }>;
}) {
  const { character: slug } = await params;
  const character = getSf6Character(slug);
  if (!character) notFound();

  const combos = listCombos(slug);
  const tips = listTips({ character: slug });

  // Prev/next character in same year
  const yearList = SF6_ROSTER.filter((c) => c.year === character.year);
  const idx = yearList.findIndex((c) => c.slug === slug);
  const prev = idx > 0 ? yearList[idx - 1] : null;
  const next = idx < yearList.length - 1 ? yearList[idx + 1] : null;

  const archetypeColor = SF6_ARCHETYPE_COLORS[character.archetype];

  return (
    <div className="max-w-3xl mx-auto px-8 md:px-12 py-14">
      {/* Crumb */}
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.25em]">
          <Link
            href="/sf6"
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            ← SF6
          </Link>
          <span className="text-[var(--color-border-strong)]">/</span>
          <span className="text-[var(--color-fg-muted)]">{character.name}</span>
        </div>
        <nav className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
          {prev && (
            <Link
              href={`/sf6/${prev.slug}`}
              className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
            >
              ← {prev.name}
            </Link>
          )}
          {prev && next && <span className="text-[var(--color-border-strong)]">·</span>}
          {next && (
            <Link
              href={`/sf6/${next.slug}`}
              className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
            >
              {next.name} →
            </Link>
          )}
        </nav>
      </div>

      {/* Character header */}
      <header className="mb-14 fade-up relative">
        <div
          className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-full"
          style={{ background: archetypeColor }}
        />
        <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-3">
          {character.year === 0 ? "Base game" : `Year ${character.year}`}
        </div>
        <h1
          className="text-6xl md:text-7xl leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
        >
          {character.name}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.22em]">
          <span style={{ color: archetypeColor }}>{character.archetype}</span>
          <span className="text-[var(--color-border-strong)]">·</span>
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--color-fg-dim)]">difficoltà</span>
            <DifficultyDots difficulty={character.difficulty} />
          </span>
          <span className="text-[var(--color-border-strong)]">·</span>
          <span className="text-[var(--color-fg-muted)] normal-case tracking-normal">
            {character.tagline}
          </span>
        </div>
      </header>

      {/* Notation cheatsheet */}
      <details className="mb-14 fade-up" style={{ animationDelay: "100ms" }}>
        <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors mb-3 list-none flex items-center gap-2">
          <span className="text-[var(--color-fg-dim)]">▸</span>
          Sintassi notation
        </summary>
        <div className="mt-3 border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg p-5 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)] space-y-3">
          <div>
            <span className="text-[var(--color-fg)] font-medium">Bottoni:</span>{" "}
            <code className="font-[var(--font-mono)]">LP MP HP LK MK HK</code> · also{" "}
            <code className="font-[var(--font-mono)]">P K PP KK</code>
          </div>
          <div>
            <span className="text-[var(--color-fg)] font-medium">Direzioni (numpad):</span>{" "}
            <code className="font-[var(--font-mono)]">1 ↙  2 ↓  3 ↘  4 ←  5 •  6 →  7 ↖  8 ↑  9 ↗</code>
          </div>
          <div>
            <span className="text-[var(--color-fg)] font-medium">Motion lettere:</span>{" "}
            <code className="font-[var(--font-mono)]">qcf = 236  ·  qcb = 214  ·  dp = 623  ·  hcf = 41236  ·  hcb = 63214</code>
          </div>
          <div>
            <span className="text-[var(--color-fg)] font-medium">Prefissi:</span>{" "}
            <code className="font-[var(--font-mono)]">cr. j. st. far. close.</code>{" "}
            (es. <code className="font-[var(--font-mono)]">cr.MK</code>,{" "}
            <code className="font-[var(--font-mono)]">j.HP</code>)
          </div>
          <div>
            <span className="text-[var(--color-fg)] font-medium">Cancel/link:</span>{" "}
            <code className="font-[var(--font-mono)]">{">"} = cancel · "xx" = cancel · , = link · ~ = rapid</code>
          </div>
          <div>
            <span className="text-[var(--color-fg)] font-medium">SF6 system:</span>{" "}
            <code className="font-[var(--font-mono)]">DI · DR · DRC · OD · SA1 · SA2 · SA3</code>
          </div>
          <div className="pt-1 border-t border-[var(--color-border)] mt-3">
            <span className="text-[var(--color-fg-dim)] uppercase tracking-wider text-[10px]">esempio:</span>{" "}
            <code className="font-[var(--font-mono)] text-[var(--color-fg-muted)]">
              cr.MK {">"} qcf+HP {">"} DRC {">"} 5HK xx SA3
            </code>
          </div>
        </div>
      </details>

      {/* Tips & tech (LLM-imported) */}
      <section className="mb-14 fade-up" style={{ animationDelay: "180ms" }}>
        <TipsList
          target={{ mode: "character", characterSlug: slug, characterName: character.name }}
          tips={tips}
        />
      </section>

      {/* Combo list */}
      <section className="fade-up" style={{ animationDelay: "240ms" }}>
        <ComboList characterSlug={slug} combos={combos} />
      </section>
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
