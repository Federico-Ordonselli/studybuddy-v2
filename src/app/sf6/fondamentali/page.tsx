import Link from "next/link";
import { listTips } from "@/lib/sf6/store";
import { TipsList, type TipRow } from "@/components/sf6/tips-list";
import { FUNDAMENTAL_TYPE_META, FUNDAMENTAL_TYPES } from "@/lib/sf6/fundamentals";

export const dynamic = "force-dynamic";

export default function Sf6FundamentalsPage() {
  const tips = listTips({ general: true });

  return (
    <div className="max-w-5xl mx-auto px-8 md:px-12 py-14">
      <Link
        href="/sf6"
        className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors mb-10"
      >
        ← Street Fighter 6
      </Link>

      <header className="mb-14 fade-up">
        <div className="flex items-baseline gap-4 mb-3">
          <span className="text-5xl text-[var(--color-accent)] leading-none">◊</span>
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
            sf6 · trasversale
          </div>
        </div>
        <h1
          className="text-5xl md:text-6xl leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
        >
          Fondamentali
        </h1>
        <p className="mt-4 text-[14px] leading-[1.7] text-[var(--color-fg-muted)] max-w-2xl">
          Concetti che valgono indipendentemente dal personaggio: meccaniche del Drive system,
          neutral game, pressure e difesa, mind games. Tutto quello che resta utile cambiando main.
        </p>
      </header>

      {/* Category legend — visible at a glance */}
      <section className="mb-12 fade-up" style={{ animationDelay: "80ms" }}>
        <h2 className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-3">
          Categorie
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {FUNDAMENTAL_TYPES.map((type) => {
            const meta = FUNDAMENTAL_TYPE_META[type];
            return (
              <div
                key={type}
                className="border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg p-3"
              >
                <div
                  className={`text-[10px] uppercase tracking-[0.22em] inline-block px-2 py-0.5 rounded border mb-2 ${meta.color} ${meta.bg} ${meta.border}`}
                >
                  {meta.label}
                </div>
                <p className="text-[11.5px] leading-relaxed text-[var(--color-fg-dim)]">
                  {meta.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="fade-up" style={{ animationDelay: "180ms" }}>
        <TipsList target={{ mode: "fundamentals" }} tips={tips} />
      </section>
    </div>
  );
}
