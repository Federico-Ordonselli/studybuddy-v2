"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flatten, initialPlayerState, panelAt, playerReducer, type PlayerAction, type PlayerState } from "@/lib/client/studioPlayer";
import type { Lesson, StudioState } from "@/lib/studioTypes";
import { StudioAudio } from "./StudioAudio";

export interface CardCounts { cardsTotal: number; cardsUnlocked: number }

/**
 * Stato del player + audio + salvataggio sul server. Il punto di ascolto si salva ogni 10 s se è cambiato, quando
 * la pagina va in background o si chiude, e subito quando una sezione si completa (è il momento in cui si
 * sbloccano le carte: la risposta riporta i conteggi aggiornati).
 */
export function useStudioPlayer(lessonId: number, lesson: Lesson, initial: StudioState, initialCounts: CardCounts) {
  const flat = useMemo(() => flatten(lesson), [lesson]);
  const [state, dispatch] = useReducer(
    (s: PlayerState, a: PlayerAction) => playerReducer(s, a, flat),
    initialPlayerState,
    (s) => playerReducer(s, { type: "RESTORE", segmentId: initial.segmentId, offset: initial.offset, rate: initial.rate, completed: initial.completedSections }, flat),
  );
  const [elapsed, setElapsed] = useState(state.offset);
  const [error, setError] = useState<unknown>(null);
  const [counts, setCounts] = useState(initialCounts);
  const [unlockedNow, setUnlockedNow] = useState<{ n: number; at: number } | null>(null);
  const controller = useRef<StudioAudio | null>(null);
  const synced = useRef({ index: -1, revision: -1 });
  const latest = useRef(state);
  useEffect(() => { latest.current = state; }, [state]);
  const lastSaved = useRef("");

  const persist = useCallback((keepalive = false) => {
    const s = latest.current;
    const segment = flat.segments[s.index]?.segment;
    const body = {
      id: lessonId,
      state: { segmentId: segment?.id ?? null, offset: Math.round((controller.current?.currentTime ?? s.offset) * 10) / 10, rate: s.rate, completedSections: s.completed },
    };
    const key = JSON.stringify(body);
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    void fetch("/api/studio/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, keepalive })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { unlocked: number; counts: CardCounts } | null) => {
        if (!r) return;
        setCounts(r.counts);
        if (r.unlocked > 0) setUnlockedNow({ n: r.unlocked, at: Date.now() });
      })
      .catch(() => { lastSaved.current = ""; });
  }, [flat, lessonId]);

  useEffect(() => {
    const audio = new StudioAudio(flat.segments, (file) => `/api/studio/audio?id=${lessonId}&file=${encodeURIComponent(file)}`, {
      onTime: setElapsed,
      onError: (e) => { setError(e); dispatch({ type: "PAUSE" }); },
      onEnded: () => {
        const next = playerReducer(latest.current, { type: "ENDED" }, flat);
        if (!next.playing) audio.pause();
        dispatch({ type: "ENDED" });
      },
    });
    synced.current = { index: -1, revision: -1 };
    controller.current = audio;
    return () => { persist(true); audio.dispose(); controller.current = null; };
  }, [flat, lessonId, persist]);

  useEffect(() => {
    if (synced.current.index !== state.index || synced.current.revision !== state.revision) {
      setElapsed(state.offset);
      setError(null);
    }
    if (synced.current.revision !== state.revision) {
      controller.current?.seek(state.index, state.offset);
      synced.current = { index: state.index, revision: state.revision };
    }
    synced.current.index = state.index;
    controller.current?.setRate(state.rate);
    if (state.playing) controller.current?.play(); else controller.current?.pause();
  }, [state.index, state.offset, state.revision, state.rate, state.playing]);

  // Sezione completata → salvataggio immediato (sblocca le carte).
  const completedKey = state.completed.join(",");
  useEffect(() => { if (completedKey) persist(); }, [completedKey, persist]);

  useEffect(() => {
    const timer = window.setInterval(() => persist(), 10_000);
    const hide = () => { if (document.visibilityState === "hidden") persist(true); };
    const leave = () => persist(true);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => { clearInterval(timer); window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", hide); };
  }, [persist]);

  const current = flat.segments[state.index];
  const chapter = current ? lesson.chapters[current.chapterIndex] : undefined;
  const section = current && chapter ? chapter.sections[current.sectionIndex] : undefined;
  const previous = useCallback(() => dispatch({ type: "PREV", elapsed: controller.current?.currentTime ?? 0 }), []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaSession) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata !== "undefined") session.metadata = new MediaMetadata({ title: section?.title ?? lesson.title, artist: "StudyBuddy · Full Studio", album: chapter?.title ?? lesson.title });
    session.playbackState = state.playing ? "playing" : "paused";
    const handlers: Partial<Record<MediaSessionAction, () => void>> = {
      play: () => dispatch({ type: "PLAY" }), pause: () => dispatch({ type: "PAUSE" }),
      previoustrack: previous, nexttrack: () => dispatch({ type: "NEXT" }),
    };
    for (const [action, handler] of Object.entries(handlers)) { try { session.setActionHandler(action as MediaSessionAction, handler); } catch { /* azione non supportata */ } }
    return () => { for (const action of Object.keys(handlers)) { try { session.setActionHandler(action as MediaSessionAction, null); } catch { /* idem */ } } };
  }, [section, chapter, lesson.title, state.playing, previous]);

  return {
    state, dispatch, flat, current, chapter, section, elapsed, error, previous, counts, unlockedNow,
    panel: section && current ? panelAt(section, current.indexInSection) : { kind: "empty" as const },
    seekSegment: (index: number) => dispatch({ type: "SEEK_SEGMENT", index }),
  };
}

export type StudioPlayerApi = ReturnType<typeof useStudioPlayer>;
