"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDuration, timeline, type PanelState } from "@/lib/client/studioPlayer";
import type { Lesson, Section, StudioState, Visual } from "@/lib/studioTypes";
import { InlineText } from "./InlineText";
import StudioQuiz from "./StudioQuiz";
import { useStudioPlayer, type CardCounts, type StudioPlayerApi } from "./useStudioPlayer";

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const btn = "rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors";

/** Lettore Full Studio: indice, testo sincronizzato, pannello codice/figura, controlli, quiz e carte della lezione. */
export default function StudioPlayer(p: {
  lessonId: number; lesson: Lesson; course: { id: number; name: string }; initial: StudioState; counts: CardCounts;
}) {
  const player = useStudioPlayer(p.lessonId, p.lesson, p.initial, p.counts);
  const [quiz, setQuiz] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const { state, dispatch, section, current, chapter, counts } = player;
  useShortcuts(player, quiz);

  useEffect(() => { document.title = section ? `${section.title} · Full Studio` : "Full Studio"; }, [section]);

  const openQuiz = () => { dispatch({ type: "PAUSE" }); setQuiz(true); };
  const completedHere = !!section && state.completed.includes(section.id);
  const { before, total } = timeline(player.flat, state.index);

  if (!section || !current || !chapter) return <p className="p-8">Lezione vuota.</p>;
  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="border-b border-border px-4 md:px-8 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <div className="text-xs text-fg-dim truncate">
            <Link href="/full-studio" className="hover:text-fg">Full Studio</Link> › {p.course.name}
          </div>
          <h1 className="font-display text-2xl tracking-tight truncate">{p.lesson.title}</h1>
        </div>
        <div className="text-sm text-fg-muted tabular-nums">
          {state.completed.length} / {player.flat.order.length} sezioni · {formatDuration(before)} di {formatDuration(total)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setIndexOpen((v) => !v)} className={`${btn} lg:hidden`} aria-expanded={indexOpen}>Indice</button>
          <button onClick={openQuiz} disabled={!state.completed.length}
            className={`${btn} disabled:text-fg-subtle disabled:hover:bg-transparent`}
            title={state.completed.length ? undefined : "Si apre dopo la prima sezione ascoltata"}>Quiz</button>
          <Link href={`/study/${p.course.id}?mode=review`} className={btn}>
            Ripassa le carte{counts.cardsTotal ? ` · ${counts.cardsUnlocked}/${counts.cardsTotal}` : ""}
          </Link>
        </div>
      </header>

      {player.unlockedNow && <Unlocked key={player.unlockedNow.at} n={player.unlockedNow.n} />}

      <div className="flex-1 grid lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,30rem)]">
        <nav aria-label="Indice della lezione"
          className={`${indexOpen ? "block" : "hidden"} lg:block border-b lg:border-b-0 lg:border-r border-border px-3 py-4 lg:max-h-[calc(100dvh-9rem)] lg:sticky lg:top-0 overflow-y-auto`}>
          {p.lesson.chapters.map((c) => (
            <div key={c.id} className="mb-4">
              <div className="px-2 mb-1 text-[11px] uppercase tracking-[0.15em] text-fg-dim"><InlineText text={c.title} /></div>
              <ul>
                {c.sections.map((s) => {
                  const done = state.completed.includes(s.id);
                  const here = s.id === section.id;
                  const empty = !s.segments.length;
                  return (
                    <li key={s.id}>
                      <button disabled={empty} onClick={() => { player.seekSegment(player.flat.sections[s.id].start); setIndexOpen(false); }}
                        aria-current={here ? "true" : undefined}
                        className={`w-full text-left flex gap-2 rounded-md px-2 py-1.5 text-sm ${here ? "bg-accent-soft text-on-accent-soft" : "hover:bg-surface-2"} disabled:text-fg-subtle`}>
                        <span aria-hidden className="w-4 shrink-0 text-center">{done ? "✓" : here ? "▸" : "·"}</span>
                        <span className="flex-1"><InlineText text={s.title} /></span>
                        <span className="sr-only">{done ? "(ascoltata)" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main className="px-4 md:px-10 py-8 min-w-0">
          <div className="text-xs text-fg-dim mb-1">
            <InlineText text={chapter.title} /> · sezione {current.sectionIndex + 1} di {chapter.sections.length}
          </div>
          <h2 className="font-display text-3xl tracking-tight leading-tight mb-6"><InlineText text={section.title} /></h2>
          {(!current.segment.audio || player.error !== null) && (
            <p role="status" className="mb-4 rounded-lg bg-[var(--warning-soft)] text-[var(--on-warning-soft)] px-4 py-2 text-sm">
              Audio non disponibile per questa frase: puoi leggere, scegliere le frasi e passare alla successiva.
            </p>
          )}
          <LessonText section={section} index={current.indexInSection} playing={state.playing}
            seek={(i) => player.seekSegment(player.flat.sections[section.id].start + i)} />
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            {completedHere ? (
              <span className="text-ok">✓ Sezione ascoltata</span>
            ) : (
              <button onClick={() => dispatch({ type: "MARK_SECTION", sectionId: section.id })} className={btn}>Segna come ascoltata</button>
            )}
            <span className="text-fg-dim">Le carte e le domande di una sezione si aprono quando la finisci.</span>
          </div>
        </main>

        <aside className="border-t lg:border-t-0 lg:border-l border-border px-4 md:px-6 py-6 min-w-0 lg:max-h-[calc(100dvh-9rem)] lg:sticky lg:top-0 overflow-y-auto">
          <Panel panel={player.panel} lesson={p.lesson} />
        </aside>
      </div>

      <PlayerBar player={player} />
      {quiz && <StudioQuiz lessonId={p.lessonId} onClose={() => setQuiz(false)} />}
    </div>
  );
}

function Unlocked({ n }: { n: number }) {
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShown(false), 5000); return () => clearTimeout(t); }, []);
  if (!shown) return null;
  return (
    <div role="status" className="fixed top-4 right-4 z-40 rounded-lg bg-[var(--success-soft)] text-[var(--on-success-soft)] border border-ok px-4 py-3 text-sm shadow-xl">
      ✓ Sezione completata: {n === 1 ? "1 carta sbloccata" : `${n} carte sbloccate`} nel ripasso.
    </div>
  );
}

/** Frasi della sezione; quella in corso evidenziata e tenuta in vista (salvo se hai appena scrollato a mano). */
function LessonText({ section, index, playing, seek }: { section: Section; index: number; playing: boolean; seek: (i: number) => void }) {
  const currentRef = useRef<HTMLSpanElement>(null);
  const pausedUntil = useRef(0);
  useEffect(() => {
    const pause = () => { pausedUntil.current = Date.now() + 4000; };
    window.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("touchmove", pause, { passive: true });
    return () => { window.removeEventListener("wheel", pause); window.removeEventListener("touchmove", pause); };
  }, []);
  useEffect(() => {
    if (!playing || Date.now() <= pausedUntil.current) return;
    currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index, section.id, playing]);
  const paragraphs = Array.from({ length: Math.ceil(section.segments.length / 4) }, (_, i) => section.segments.slice(i * 4, i * 4 + 4));
  return (
    <article className="max-w-[68ch] text-lg leading-relaxed">
      {paragraphs.map((segments, pi) => (
        <p key={pi} className="mb-5">
          {segments.map((s, si) => {
            const n = pi * 4 + si;
            const here = n === index;
            return (
              <span key={s.id}>
                <span role="button" tabIndex={0} ref={here ? currentRef : undefined} aria-current={here ? "true" : undefined}
                  onClick={() => { pausedUntil.current = 0; seek(n); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); seek(n); } }}
                  className={`cursor-pointer rounded-sm transition-colors ${here ? "bg-accent-soft text-on-accent-soft" : n > index ? "text-fg-dim hover:text-fg" : "hover:bg-surface-2"}`}>
                  <InlineText text={s.text} />
                </span>{" "}
              </span>
            );
          })}
        </p>
      ))}
    </article>
  );
}

function Panel({ panel, lesson }: { panel: PanelState; lesson: Lesson }) {
  const activeRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const block = panel.kind === "code" ? lesson.codeBlocks[panel.ref] : undefined;
  const [start, end] = panel.kind === "code" && panel.highlight ? panel.highlight : [0, 0];
  useEffect(() => {
    const line = activeRef.current, box = boxRef.current;
    if (!line || !box) return;
    const top = line.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + line.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3) });
  }, [start, block]);

  if (panel.kind === "visual") return <VisualPanel visual={panel.visual} />;
  if (!block) {
    return <p className="text-sm text-fg-dim">Codice, figure e tabelle compaiono qui quando la lezione ci arriva.</p>;
  }
  return (
    <figure>
      <figcaption className="text-xs text-fg-dim mb-2"><InlineText text={block.file || block.lang || "Codice"} /></figcaption>
      <div ref={boxRef} className="rounded-lg border border-border bg-surface overflow-auto max-h-[70dvh]">
        <pre className="font-mono text-[13px] leading-6 py-3"><code>
          {block.code.split("\n").map((line, i) => {
            const on = start > 0 && i + 1 >= start && i + 1 <= end;
            return (
              <span key={i} ref={i + 1 === start ? activeRef : undefined} data-line={i + 1}
                className={`flex pr-4 ${on ? "bg-accent-soft text-on-accent-soft" : ""}`}>
                <span aria-hidden className="w-10 shrink-0 text-right pr-3 text-fg-subtle select-none">{i + 1}</span>
                <span className="whitespace-pre">{line || " "}</span>
              </span>
            );
          })}
        </code></pre>
      </div>
      {start > 0 && <p className="sr-only">Righe evidenziate: {start === end ? start : `${start}–${end}`}</p>}
    </figure>
  );
}

function VisualPanel({ visual }: { visual: Visual }) {
  return (
    <section>
      {visual.title && <h3 className="font-display text-lg mb-3"><InlineText text={visual.title} /></h3>}
      {visual.kind === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2"><tr>{visual.headers.map((h, i) => <th key={i} scope="col" className="text-left px-3 py-2 font-medium"><InlineText text={h} /></th>)}</tr></thead>
            <tbody>{visual.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top"><InlineText text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        (() => {
          const items = visual.items.map((s, i) => <li key={i}><InlineText text={s} /></li>);
          return visual.ordered ? <ol className="list-decimal pl-5 flex flex-col gap-2 text-sm">{items}</ol> : <ul className="list-disc pl-5 flex flex-col gap-2 text-sm">{items}</ul>;
        })()
      )}
    </section>
  );
}

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={d} /></svg>;
}

function PlayerBar({ player }: { player: StudioPlayerApi }) {
  const { state, section, current, elapsed, dispatch } = player;
  if (!section || !current) return null;
  const durations = section.segments.map((s) => s.duration || 0);
  const total = durations.reduce((a, b) => a + b, 0);
  const at = durations.slice(0, current.indexInSection).reduce((a, b) => a + b, 0) + elapsed;
  const start = player.flat.sections[section.id].start;
  const seek = (value: number) => {
    let sum = 0;
    let target = durations.findIndex((d) => { sum += d; return sum > value; });
    if (target < 0) target = durations.length - 1;
    player.seekSegment(start + target);
  };
  const ctl = "p-2 rounded-full hover:bg-surface-2";
  return (
    <footer className="sticky bottom-0 z-30 border-t border-border bg-raised px-4 md:px-8 py-3 flex items-center gap-4">
      <div className="flex items-center gap-1">
        <button className={ctl} aria-label="Sezione precedente" title="Sezione precedente (Maiusc+←)" onClick={() => dispatch({ type: "PREV_SECTION" })}><Icon d="M15 5l-7 7 7 7M5 5v14" /></button>
        <button className={ctl} aria-label="Frase precedente" title="Frase precedente (←)" onClick={player.previous}><Icon d="M15 5l-7 7 7 7" /></button>
        <button className="p-3 rounded-full bg-accent text-on-accent hover:bg-accent-hover" aria-label={state.playing ? "Pausa" : "Riproduci"} title="Spazio"
          onClick={() => dispatch({ type: "TOGGLE" })}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="currentColor">{state.playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="M8 4v16l13-8z" />}</svg>
        </button>
        <button className={ctl} aria-label="Frase successiva" title="Frase successiva (→)" onClick={() => dispatch({ type: "NEXT" })}><Icon d="M9 5l7 7-7 7" /></button>
        <button className={ctl} aria-label="Sezione successiva" title="Sezione successiva (Maiusc+→)" onClick={() => dispatch({ type: "NEXT_SECTION" })}><Icon d="M9 5l7 7-7 7M19 5v14" /></button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-3 text-xs text-fg-dim">
          <span className="truncate"><InlineText text={section.title} /></span>
          <span className="tabular-nums">{current.indexInSection + 1}/{section.segments.length}</span>
        </div>
        <input type="range" className="w-full accent-[var(--accent)]" aria-label="Avanzamento della sezione"
          min={0} max={total || Math.max(1, section.segments.length - 1)} step={total ? 0.01 : 1}
          value={total ? Math.min(at, total) : current.indexInSection}
          aria-valuetext={`Frase ${current.indexInSection + 1} di ${section.segments.length}${total ? `, ${time(at)} di ${time(total)}` : ""}`}
          onChange={(e) => (total ? seek(Number(e.target.value)) : player.seekSegment(start + Math.round(Number(e.target.value))))} />
        <div className="flex justify-between text-xs text-fg-dim tabular-nums">
          <span>{time(at)}</span><span>{total ? time(total) : "audio in preparazione"}</span>
        </div>
      </div>
      <button className="rounded-lg border border-border-strong px-3 py-1.5 text-sm tabular-nums hover:bg-surface-2"
        aria-label={`Velocità ${state.rate}×, cambia`} title="Velocità (+ / −)"
        onClick={() => dispatch({ type: "SET_RATE", rate: state.rate >= 2 ? 0.75 : state.rate + 0.25 })}>{state.rate}×</button>
    </footer>
  );
}

/** Spazio play/pausa, ←/→ frase, Maiusc+←/→ sezione, +/− velocità. Inattive nei campi e con il quiz aperto. */
function useShortcuts(player: StudioPlayerApi, blocked: boolean) {
  const ref = useRef(player);
  useEffect(() => { ref.current = player; });
  useEffect(() => {
    if (blocked) return;
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input,textarea,select,button,a,[contenteditable='true'],[role='dialog'],[role='button']")) return;
      const p = ref.current;
      switch (e.key) {
        case " ": p.dispatch({ type: "TOGGLE" }); break;
        case "ArrowLeft": if (e.shiftKey) p.dispatch({ type: "PREV_SECTION" }); else p.previous(); break;
        case "ArrowRight": p.dispatch({ type: e.shiftKey ? "NEXT_SECTION" : "NEXT" }); break;
        case "+": case "=": p.dispatch({ type: "SET_RATE", rate: p.state.rate + 0.25 }); break;
        case "-": p.dispatch({ type: "SET_RATE", rate: p.state.rate - 0.25 }); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [blocked]);
}
