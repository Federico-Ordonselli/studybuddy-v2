import type { Lesson, Section, Segment, Visual } from "@/lib/studioTypes";

/**
 * Logica pura del player Full Studio (portata da `Full_studio/app/src/player`): lezione appiattita in segmenti,
 * reducer dello stato di ascolto e pannello codice/visual del segmento corrente. Il controller audio sta in
 * `StudioAudio` (DOM). Differenza dall'originale: una sezione è «completata» quando finisce il suo ultimo segmento
 * (o la segni a mano), ed è questo che sblocca carte e quiz.
 */

export interface PlaySegment { segment: Segment; chapterId: string; sectionId: string; chapterIndex: number; sectionIndex: number; indexInSection: number; globalIndex: number }
export interface FlatLesson { segments: PlaySegment[]; sections: Record<string, { start: number; end: number }>; order: string[] }

/** Fine sezione inclusiva; le sezioni vuote hanno end = start - 1. */
export function flatten(lesson: Lesson): FlatLesson {
  const segments: PlaySegment[] = [];
  const sections: FlatLesson["sections"] = {};
  const order: string[] = [];
  lesson.chapters.forEach((chapter, chapterIndex) => {
    chapter.sections.forEach((section, sectionIndex) => {
      const start = segments.length;
      section.segments.forEach((segment, indexInSection) => segments.push({ segment, chapterId: chapter.id, sectionId: section.id, chapterIndex, sectionIndex, indexInSection, globalIndex: segments.length }));
      sections[section.id] = { start, end: segments.length - 1 };
      order.push(section.id);
    });
  });
  return { segments, sections, order };
}

export interface PlayerState { index: number; playing: boolean; rate: number; offset: number; revision: number; completed: string[] }
export const initialPlayerState: PlayerState = { index: 0, playing: false, rate: 1, offset: 0, revision: 0, completed: [] };

export type PlayerAction =
  | { type: "PLAY" | "PAUSE" | "TOGGLE" | "NEXT" | "NEXT_SECTION" | "PREV_SECTION" | "ENDED" }
  | { type: "PREV"; elapsed: number }
  | { type: "SEEK_SEGMENT"; index: number }
  | { type: "SET_RATE"; rate: number }
  | { type: "MARK_SECTION"; sectionId: string }
  | { type: "RESTORE"; segmentId: string | null; offset: number; rate: number; completed: string[] };

export const clampRate = (rate: number) => (Number.isFinite(rate) ? Math.min(2, Math.max(0.75, Math.round(rate * 4) / 4)) : 1);

/** Sezioni completate nell'ordine della lezione, senza duplicati né id sconosciuti. */
function ordered(flat: FlatLesson, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return flat.order.filter((id) => set.has(id));
}

export function playerReducer(state: PlayerState, action: PlayerAction, flat: FlatLesson): PlayerState {
  const current = flat.segments[state.index];
  const move = (index: number): PlayerState => ({ ...state, index: Math.max(0, Math.min(flat.segments.length - 1, index)), offset: 0, revision: state.revision + 1 });
  switch (action.type) {
    case "PLAY": return { ...state, playing: !!current };
    case "PAUSE": return { ...state, playing: false };
    case "TOGGLE": return { ...state, playing: !!current && !state.playing };
    case "SET_RATE": return { ...state, rate: clampRate(action.rate) };
    case "SEEK_SEGMENT": return move(Number.isFinite(action.index) ? Math.trunc(action.index) : 0);
    case "NEXT": return move(state.index + 1);
    case "PREV": return move(state.index - (action.elapsed > 3 ? 0 : 1));
    case "NEXT_SECTION": {
      const end = current ? flat.sections[current.sectionId].end : -1;
      return move(end + 1 < flat.segments.length ? end + 1 : state.index);
    }
    case "PREV_SECTION": {
      const start = current ? flat.sections[current.sectionId].start : 0;
      // A metà sezione si torna al suo inizio; dall'inizio, alla sezione precedente.
      if (state.index > start) return move(start);
      return move(start > 0 ? flat.sections[flat.segments[start - 1].sectionId].start : 0);
    }
    case "MARK_SECTION":
      return flat.sections[action.sectionId] ? { ...state, completed: ordered(flat, [...state.completed, action.sectionId]) } : state;
    case "RESTORE": {
      const index = flat.segments.findIndex((s) => s.segment.id === action.segmentId);
      return {
        ...initialPlayerState,
        revision: state.revision + 1,
        index: Math.max(0, index),
        offset: index >= 0 ? Math.max(0, Math.min(action.offset, flat.segments[index].segment.duration ?? Infinity)) : 0,
        rate: clampRate(action.rate),
        completed: ordered(flat, action.completed),
      };
    }
    case "ENDED": {
      if (!current) return { ...state, playing: false };
      const next = flat.segments[state.index + 1];
      const sectionDone = flat.sections[current.sectionId].end === state.index;
      const completed = sectionDone ? ordered(flat, [...state.completed, current.sectionId]) : state.completed;
      // L'avanzamento automatico non cambia `revision`: il controller audio ha già scambiato i due elementi.
      if (!next) return { ...state, playing: false, completed, revision: state.revision + 1 };
      return { ...state, index: state.index + 1, offset: 0, completed, revision: state.playing ? state.revision : state.revision + 1 };
    }
  }
}

export type PanelState =
  | { kind: "empty" }
  | { kind: "code"; ref: string; highlight: [number, number] | null }
  | { kind: "visual"; visual: Visual };

/** Pannello visibile al segmento `segmentIndex` della sezione: l'ultimo codice o visual comparso finora. */
export function panelAt(section: Section, segmentIndex: number): PanelState {
  let panel: PanelState = { kind: "empty" };
  for (let i = 0; i <= Math.min(segmentIndex, section.segments.length - 1); i++) {
    const segment = section.segments[i];
    if (segment.code) panel = { kind: "code", ref: segment.code.ref, highlight: segment.code.highlight };
    else if (segment.visual) panel = { kind: "visual", visual: segment.visual };
  }
  return panel;
}

/** Secondi totali di audio e secondi già passati prima del segmento `index`. */
export function timeline(flat: FlatLesson, index: number) {
  let before = 0;
  let total = 0;
  flat.segments.forEach((s, i) => { const d = s.segment.duration ?? 0; total += d; if (i < index) before += d; });
  return { before, total };
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
