import type { PlaySegment } from "@/lib/client/studioPlayer";

/**
 * Due elementi <audio> alternati (A/B): mentre uno suona l'altro precarica il segmento successivo, così fra una
 * frase e l'altra non c'è silenzio. Portato da `Full_studio/app/src/player/audioController.ts`; l'URL di ogni mp3
 * passa da `/api/studio/audio` (percorso validato sul server).
 */
export interface AudioEvents { onTime?: (seconds: number) => void; onEnded?: () => void; onError?: (error: unknown) => void }

export class StudioAudio {
  private elements: [HTMLAudioElement, HTMLAudioElement];
  private active = 0;
  private index = -1;
  private playing = false;
  private disposed = false;
  private generation = 0;

  constructor(private segments: PlaySegment[], private url: (file: string) => string, private events: AudioEvents = {}) {
    this.elements = [new Audio(), new Audio()];
    this.elements.forEach((audio, slot) => {
      audio.preload = "auto";
      audio.preservesPitch = true;
      audio.ontimeupdate = () => { if (slot === this.active) this.events.onTime?.(audio.currentTime); };
      audio.onerror = () => { if (slot === this.active) { this.pause(); this.events.onError?.(audio.error); } };
      audio.onended = () => {
        if (slot !== this.active) return;
        this.events.onEnded?.();
        if (!this.playing || this.index + 1 >= this.segments.length) { this.pause(); return; }
        this.elements[this.active].onloadedmetadata = null;
        this.index++;
        this.active = 1 - this.active;
        this.start();
        this.preload();
      };
    });
  }

  get currentTime() { return this.elements[this.active].currentTime; }

  private source(index: number) {
    const file = this.segments[index]?.segment.audio;
    return file ? this.url(file) : "";
  }
  private assign(audio: HTMLAudioElement, index: number) {
    const src = this.source(index);
    if (audio.getAttribute("src") !== src) {
      if (src) audio.src = src; else audio.removeAttribute("src");
      audio.load();
    }
  }
  private preload() { this.assign(this.elements[1 - this.active], this.index + 1); }
  private start() {
    const audio = this.elements[this.active];
    if (!audio.getAttribute("src")) { this.pause(); this.events.onError?.(new Error("Audio non disponibile")); return; }
    const generation = ++this.generation;
    try {
      void audio.play().catch((error) => { if (!this.disposed && generation === this.generation) { this.pause(); this.events.onError?.(error); } });
    } catch (error) { this.pause(); this.events.onError?.(error); }
  }

  seek(index: number, offset = 0) {
    this.elements[this.active].pause();
    this.generation++;
    this.index = index;
    const audio = this.elements[this.active];
    this.assign(audio, index);
    const apply = () => { audio.currentTime = Math.max(0, Math.min(offset, Number.isFinite(audio.duration) ? audio.duration : Infinity)); };
    audio.onloadedmetadata = apply;
    apply();
    this.preload();
    if (this.playing) this.start();
  }
  play() { this.playing = true; this.start(); }
  pause() { this.playing = false; this.generation++; this.elements.forEach((a) => a.pause()); }
  setRate(rate: number) { this.elements.forEach((a) => { a.playbackRate = rate; a.preservesPitch = true; }); }
  dispose() {
    this.disposed = true;
    this.pause();
    this.elements.forEach((a) => { a.onended = a.ontimeupdate = a.onerror = a.onloadedmetadata = null; a.removeAttribute("src"); a.load(); });
  }
}
