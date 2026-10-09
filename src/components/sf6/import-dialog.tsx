"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotationRenderer } from "./notation-renderer";
import { FUNDAMENTAL_TYPE_META } from "@/lib/sf6/fundamentals";
import { cn } from "@/lib/cn";

type ExtractedItem = {
  type:
    | "overview"
    | "combo"
    | "tech"
    | "strategy"
    | "matchup"
    | "general"
    | "system"
    | "neutral"
    | "offense"
    | "defense"
    | "mental";
  title: string;
  content: string;
  notation: string | null;
};

type TypeMeta = { label: string; color: string; bg: string; border: string };

const CHARACTER_TYPE_META: Record<string, TypeMeta> = {
  overview: { label: "Overview",  color: "text-[var(--color-accent)]",   bg: "bg-[var(--color-accent)]/15", border: "border-[var(--color-accent)]/50" },
  combo:    { label: "Combo",     color: "text-[#F0CC75]",                bg: "bg-[#D4A437]/15",             border: "border-[#D4A437]/40" },
  tech:     { label: "Tech",      color: "text-[#7CC0B7]",                bg: "bg-[#5FA89F]/15",             border: "border-[#5FA89F]/40" },
  strategy: { label: "Strategy",  color: "text-[#B86FB5]",                bg: "bg-[#B86FB5]/15",             border: "border-[#B86FB5]/40" },
  matchup:  { label: "Matchup",   color: "text-[#E07B3D]",                bg: "bg-[#E07B3D]/15",             border: "border-[#E07B3D]/40" },
  general:  { label: "General",   color: "text-[var(--color-fg-muted)]",  bg: "bg-[var(--color-surface-2)]", border: "border-[var(--color-border)]" },
};

const FUNDAMENTALS_TYPE_META: Record<string, TypeMeta> = {
  overview: { label: "Overview", color: "text-[var(--color-accent)]", bg: "bg-[var(--color-accent)]/15", border: "border-[var(--color-accent)]/50" },
  system:   FUNDAMENTAL_TYPE_META.system,
  neutral:  FUNDAMENTAL_TYPE_META.neutral,
  offense:  FUNDAMENTAL_TYPE_META.offense,
  defense:  FUNDAMENTAL_TYPE_META.defense,
  mental:   FUNDAMENTAL_TYPE_META.mental,
};

type Stage = "compose" | "fetchingUrl" | "extracting" | "review" | "saving" | "done";

/**
 * Discriminated mode prop. 'character' targets a specific roster slug;
 * 'fundamentals' targets the SF6 generale section (no character).
 */
export type ImportTarget =
  | { mode: "character"; characterSlug: string; characterName: string }
  | { mode: "fundamentals" };

export function ImportDialog({
  target,
  onClose,
}: {
  target: ImportTarget;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("compose");
  const [source, setSource] = useState<"url" | "vod" | "upload">("url");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [vodsDir, setVodsDir] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // VOD listing
  const [vods, setVods] = useState<{ filename: string; size_mb: number; modified_at: string }[] | null>(null);
  const [vodSelected, setVodSelected] = useState("");
  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isFundamentals = target.mode === "fundamentals";
  const typeMeta = isFundamentals ? FUNDAMENTALS_TYPE_META : CHARACTER_TYPE_META;
  const headerLabel = isFundamentals ? "Fondamentali SF6" : target.characterName;
  const headerSub = isFundamentals
    ? "importa da transcript · concetti universali"
    : "importa da transcript · personaggio";

  // Load VOD list once when user switches to that tab.
  // (useEffect would re-import — keep inline)
  async function loadVods() {
    try {
      const res = await fetch("/api/sf6/vods");
      const data = (await res.json()) as { dir?: string; files?: { filename: string; size_mb: number; modified_at: string }[] };
      setVods(data.files ?? []);
      setVodsDir(data.dir ?? null);
    } catch {
      setVods([]);
    }
  }
  if (source === "vod" && vods === null) {
    // Fire and forget on first switch
    loadVods();
  }

  /**
   * Generic transcript fetcher. Calls /api/sf6/transcribe with one of:
   *   { url } / { vod_filename } / { upload_id }
   * and populates transcript + sourceTitle on success.
   */
  async function fetchTranscript(payload: Record<string, unknown>) {
    setError(null);
    setInfo(null);
    setStage("fetchingUrl");
    try {
      const res = await fetch("/api/sf6/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as
        | { transcript: string; title: string; language: string; source: string }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Errore ${res.status}`);
        setStage("compose");
        return;
      }
      setTranscript(data.transcript);
      if (!sourceTitle.trim()) setSourceTitle(data.title);
      const sourceLabel =
        data.source === "subs" ? "sottotitoli YouTube"
        : data.source === "whisper-groq" ? "Groq Whisper"
        : data.source === "whisper-local" ? "Whisper locale"
        : data.source;
      setInfo(
        `Transcript pronto via ${sourceLabel} (${data.transcript.length.toLocaleString("it-IT")} caratteri, lingua "${data.language}").`
      );
      setStage("compose");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di rete");
      setStage("compose");
    }
  }

  async function uploadAndTranscribe() {
    if (!uploadFile) return;
    setError(null);
    setInfo(null);
    setStage("fetchingUrl");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      setInfo(`Carico ${uploadFile.name} (${(uploadFile.size / 1024 / 1024).toFixed(1)} MB)…`);
      const upRes = await fetch("/api/sf6/upload", { method: "POST", body: form });
      const upData = (await upRes.json()) as { upload_id?: string; error?: string };
      if (!upRes.ok || !upData.upload_id) {
        setError(upData.error ?? `Errore upload ${upRes.status}`);
        setStage("compose");
        return;
      }
      // Now run the transcribe pipeline on the uploaded id
      if (!sourceTitle.trim()) setSourceTitle(uploadFile.name.replace(/\.[^.]+$/, ""));
      setInfo("Upload completato, avvio trascrizione…");
      await fetchTranscript({ upload_id: upData.upload_id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di rete");
      setStage("compose");
    }
  }

  async function analyze() {
    setError(null);
    setInfo(null);
    if (transcript.trim().length < 20) {
      setError("Transcript troppo corto per estrarre qualcosa di utile.");
      return;
    }
    setStage("extracting");
    try {
      const body: Record<string, unknown> = {
        transcript,
        source_title: sourceTitle || undefined,
      };
      if (isFundamentals) {
        body.is_general = true;
      } else {
        body.character_slug = target.characterSlug;
      }
      const res = await fetch("/api/sf6/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        setError(`Errore ${res.status}: ${errText}`);
        setStage("compose");
        return;
      }
      const data = (await res.json()) as { items: ExtractedItem[]; truncated?: boolean };
      if (!data.items || data.items.length === 0) {
        setError(
          isFundamentals
            ? "L'AI non ha estratto nessun elemento utile. Il transcript parla davvero di fondamentali SF6?"
            : "L'AI non ha estratto nessun elemento utile. Il transcript parla davvero del personaggio?"
        );
        setStage("compose");
        return;
      }
      setTruncated(Boolean(data.truncated));
      setItems(data.items);
      setAccepted(new Array(data.items.length).fill(true));
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto");
      setStage("compose");
    }
  }

  async function save() {
    setError(null);
    const toSave = items.filter((_, i) => accepted[i]);
    if (toSave.length === 0) {
      setError("Seleziona almeno un elemento da salvare.");
      return;
    }
    setStage("saving");

    const body: Record<string, unknown> = {
      source_title: sourceTitle || undefined,
      source_url: sourceUrl || undefined,
      items: toSave,
    };
    if (isFundamentals) {
      body.is_general = true;
    } else {
      body.character_slug = target.characterSlug;
    }

    const tipsRes = await fetch("/api/sf6/tips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!tipsRes.ok) {
      setError(`Errore salvataggio: ${await tipsRes.text()}`);
      setStage("review");
      return;
    }

    setStage("done");
    startTransition(() => {
      router.refresh();
      setTimeout(onClose, 1000);
    });
  }

  async function promoteToComboLibrary(idx: number) {
    if (target.mode !== "character") return;
    const it = items[idx];
    if (it.type !== "combo" || !it.notation) return;
    const res = await fetch("/api/sf6/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character_slug: target.characterSlug,
        notation: it.notation,
        situation: it.title,
        notes: it.content,
        status: "learning",
      }),
    });
    if (!res.ok) {
      setError(`Errore ${res.status}: impossibile aggiungere la combo alla library.`);
      return;
    }
    setAccepted((a) => {
      const next = [...a];
      next[idx] = false;
      return next;
    });
    startTransition(() => router.refresh());
  }

  const overviewCount = items.filter((i) => i.type === "overview").length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-md pt-8 pb-12 px-4">
      <div className="w-full max-w-5xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-fg-dim)] mb-1">
              {headerSub}
            </div>
            <h2
              className="text-2xl tracking-tight leading-none"
              style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}
            >
              {headerLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] text-2xl leading-none"
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
          <StepDot active={stage === "compose" || stage === "fetchingUrl"} done={stage === "review" || stage === "saving" || stage === "done"}>
            1 · transcript
          </StepDot>
          <span className="text-[var(--color-border-strong)]">—</span>
          <StepDot
            active={stage === "extracting" || stage === "review"}
            done={stage === "saving" || stage === "done"}
          >
            2 · review
          </StepDot>
          <span className="text-[var(--color-border-strong)]">—</span>
          <StepDot active={stage === "saving"} done={stage === "done"}>
            3 · salva
          </StepDot>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {(stage === "compose" || stage === "fetchingUrl") && (
            <div className="space-y-5">
              {/* Source picker tabs */}
              <div className="flex gap-1 border-b border-[var(--color-border)]">
                {(["url", "vod", "upload"] as const).map((s) => {
                  const label = s === "url" ? "URL" : s === "vod" ? "File VOD" : "Upload";
                  return (
                    <button
                      key={s}
                      onClick={() => setSource(s)}
                      disabled={stage === "fetchingUrl"}
                      className={cn(
                        "px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] transition-colors -mb-px border-b-2",
                        source === s
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-transparent text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Two-column layout: source-specific inputs on the left,
                  transcript editor on the right. Stacks on small screens. */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2 space-y-4">

              {/* URL source */}
              {source === "url" && (
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
                    URL (YouTube, Twitch VOD, …)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=…  o  https://twitch.tv/videos/…"
                      disabled={stage === "fetchingUrl"}
                      className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-[var(--font-mono)] focus:outline-none focus:border-[var(--color-border-strong)] disabled:opacity-50"
                    />
                    <button
                      onClick={() => fetchTranscript({ url: sourceUrl.trim() })}
                      disabled={!sourceUrl.trim() || stage === "fetchingUrl"}
                      className={cn(
                        "px-4 py-2 rounded-md text-[11px] uppercase tracking-[0.2em] font-medium transition-all whitespace-nowrap",
                        sourceUrl.trim() && stage !== "fetchingUrl"
                          ? "bg-[var(--color-surface-2)] text-[var(--color-fg)] ring-1 ring-[var(--color-border-strong)] hover:bg-[var(--color-surface)]"
                          : "bg-[var(--color-surface-2)] text-[var(--color-fg-dim)] cursor-not-allowed"
                      )}
                    >
                      {stage === "fetchingUrl" ? "scarico…" : "↓ scarica"}
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-dim)] leading-relaxed">
                    YouTube: prima prova i sub auto-generati. Se non ci sono, scarica l&apos;audio e
                    lo trascrive con <span className="text-[var(--color-fg-muted)]">Whisper</span> (locale, o Groq se configurato).
                    Per Twitch e altri va sempre via Whisper. Un VOD di ore richiede qualche minuto.
                  </div>
                </div>
              )}

              {/* VOD source */}
              {source === "vod" && (
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
                    File in <span className="font-[var(--font-mono)] normal-case tracking-normal">{vodsDir ?? "cartella VOD"}</span>
                  </label>
                  {vods === null ? (
                    <div className="text-[12px] text-[var(--color-fg-dim)] italic">Caricamento…</div>
                  ) : vods.length === 0 ? (
                    <div className="border border-dashed border-[var(--color-border)] rounded px-4 py-6 text-center text-[12px] text-[var(--color-fg-dim)] space-y-1.5">
                      <p>Nessun file. Copia mp4/mkv/mp3 in <span className="font-[var(--font-mono)] text-[var(--color-fg-muted)]">{vodsDir ?? "cartella VOD"}</span>.</p>
                      <p className="text-[11px]">poi premi il refresh qui sotto</p>
                      <button
                        onClick={loadVods}
                        className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] hover:underline"
                      >
                        ↻ ricarica
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <select
                          value={vodSelected}
                          onChange={(e) => setVodSelected(e.target.value)}
                          disabled={stage === "fetchingUrl"}
                          className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-border-strong)]"
                        >
                          <option value="">— seleziona —</option>
                          {vods.map((v) => (
                            <option key={v.filename} value={v.filename}>
                              {v.filename}  ({v.size_mb} MB)
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={loadVods}
                          className="px-3 py-2 rounded-md text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] border border-[var(--color-border)]"
                          title="Ricarica lista"
                        >
                          ↻
                        </button>
                        <button
                          onClick={() => fetchTranscript({ vod_filename: vodSelected })}
                          disabled={!vodSelected || stage === "fetchingUrl"}
                          className={cn(
                            "px-4 py-2 rounded-md text-[11px] uppercase tracking-[0.2em] font-medium transition-all whitespace-nowrap",
                            vodSelected && stage !== "fetchingUrl"
                              ? "bg-[var(--color-surface-2)] text-[var(--color-fg)] ring-1 ring-[var(--color-border-strong)] hover:bg-[var(--color-surface)]"
                              : "bg-[var(--color-surface-2)] text-[var(--color-fg-dim)] cursor-not-allowed"
                          )}
                        >
                          {stage === "fetchingUrl" ? "trascrivo…" : "↓ trascrivi"}
                        </button>
                      </div>
                      <div className="text-[10.5px] text-[var(--color-fg-dim)] leading-relaxed">
                        Il file viene trascritto con Whisper. Niente upload: il file resta dov&apos;è.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Upload source */}
              {source === "upload" && (
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
                    Carica file audio/video (≤ 500 MB)
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="file"
                      accept="audio/*,video/*,.mp3,.m4a,.wav,.flac,.ogg,.opus,.mp4,.mkv,.webm,.mov,.avi"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                      disabled={stage === "fetchingUrl"}
                      className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-[var(--color-surface-2)] file:text-[var(--color-fg-muted)] file:text-[11px] file:uppercase file:tracking-wider"
                    />
                    <button
                      onClick={uploadAndTranscribe}
                      disabled={!uploadFile || stage === "fetchingUrl"}
                      className={cn(
                        "px-4 py-2 rounded-md text-[11px] uppercase tracking-[0.2em] font-medium transition-all whitespace-nowrap",
                        uploadFile && stage !== "fetchingUrl"
                          ? "bg-[var(--color-surface-2)] text-[var(--color-fg)] ring-1 ring-[var(--color-border-strong)] hover:bg-[var(--color-surface)]"
                          : "bg-[var(--color-surface-2)] text-[var(--color-fg-dim)] cursor-not-allowed"
                      )}
                    >
                      {stage === "fetchingUrl" ? "lavoro…" : "↑ carica + trascrivi"}
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-dim)] leading-relaxed">
                    Per file molto grandi conviene metterli in <span className="font-[var(--font-mono)] text-[var(--color-fg-muted)]">{vodsDir ?? "cartella VOD"}</span>{" "}
                    e usare il tab precedente: evita di rifare l&apos;upload se ripeti l&apos;analisi.
                  </div>
                </div>
              )}

                  {/* Title sits under the source controls in the left column */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
                      Titolo (auto-compilato se carichi da YouTube)
                    </label>
                    <input
                      type="text"
                      value={sourceTitle}
                      onChange={(e) => setSourceTitle(e.target.value)}
                      placeholder={isFundamentals ? "es. SF6 Drive System Explained" : "es. CAMMY Combo Guide Season 3"}
                      className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-border-strong)]"
                    />
                  </div>
                </div>

                {/* Right column: transcript editor takes the remaining space */}
                <div className="lg:col-span-3 flex flex-col">

              {/* Transcript */}
                  <div className="flex flex-col flex-1">
                    <label className="block text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-dim)] mb-1.5">
                      Transcript
                    </label>
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      placeholder="Si compila da solo se carichi da YouTube o trascrivi un VOD. Oppure incollalo a mano qui."
                      className="w-full flex-1 min-h-[280px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-[var(--color-border-strong)] resize-y font-[var(--font-mono)]"
                    />
                    <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-dim)] tabular">
                      {transcript.length.toLocaleString("it-IT")} caratteri ·{" "}
                      {transcript.trim().split(/\s+/).filter(Boolean).length.toLocaleString("it-IT")} parole
                    </div>
                  </div>
                </div>
              </div>

              {info && (
                <div className="text-[12px] text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 px-3 py-2 rounded leading-relaxed">
                  {info}
                </div>
              )}
              {error && <ErrorBox>{error}</ErrorBox>}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)] mt-2">
                <button
                  onClick={onClose}
                  className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  Annulla
                </button>
                <button
                  onClick={analyze}
                  disabled={transcript.trim().length < 20 || stage === "fetchingUrl"}
                  className={cn(
                    "px-5 py-2 rounded-md text-xs uppercase tracking-[0.2em] font-medium transition-all",
                    transcript.trim().length >= 20 && stage !== "fetchingUrl"
                      ? "bg-[var(--color-accent)] text-[var(--color-bg)] hover:brightness-110"
                      : "bg-[var(--color-surface-2)] text-[var(--color-fg-dim)] cursor-not-allowed"
                  )}
                >
                  Analizza con AI →
                </button>
              </div>
            </div>
          )}

          {stage === "extracting" && (
            <div className="py-16 text-center space-y-3">
              <div className="inline-flex gap-1.5">
                <span className="w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
              </div>
              <div className="text-sm text-[var(--color-fg-muted)]">
                L'AI sta analizzando il transcript…
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                può richiedere 30 secondi – 10 minuti su Ollama locale
              </div>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-[var(--color-fg)]">
                  <span className="font-[var(--font-mono)] tabular text-[var(--color-accent)]">
                    {items.length}
                  </span>{" "}
                  elementi estratti{overviewCount > 0 ? " (incluso overview narrativo)" : ""}.{" "}
                  <span className="text-[var(--color-fg-muted)]">Seleziona quelli da salvare.</span>
                </div>
                <div className="flex gap-2 text-[10px] uppercase tracking-[0.18em]">
                  <button
                    onClick={() => setAccepted(items.map(() => true))}
                    className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                  >
                    tutto
                  </button>
                  <span className="text-[var(--color-border-strong)]">·</span>
                  <button
                    onClick={() => setAccepted(items.map(() => false))}
                    className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                  >
                    niente
                  </button>
                </div>
              </div>

              {truncated && (
                <p className="text-[11.5px] text-[var(--color-danger)] mb-3">
                  Trascrizione molto lunga: l&apos;analisi ha usato solo la prima parte (60 000 caratteri).
                </p>
              )}

              <ul className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {items.map((it, i) => {
                  const meta = typeMeta[it.type] ?? typeMeta.general ?? CHARACTER_TYPE_META.general;
                  const isAccepted = accepted[i];
                  const isOverview = it.type === "overview";
                  return (
                    <li
                      key={i}
                      className={cn(
                        "rounded-lg border transition-all",
                        isAccepted
                          ? isOverview
                            ? "bg-[var(--color-accent)]/5 border-[var(--color-accent)]/40"
                            : "bg-[var(--color-surface-2)] border-[var(--color-border-strong)]"
                          : "bg-[var(--color-surface)] border-[var(--color-border)] opacity-50"
                      )}
                    >
                      <label className="flex items-start gap-3 p-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAccepted}
                          onChange={() =>
                            setAccepted((a) => {
                              const next = [...a];
                              next[i] = !next[i];
                              return next;
                            })
                          }
                          className="mt-1 w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
                        />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span
                              className={cn(
                                "text-[9.5px] uppercase tracking-[0.2em] px-2 py-0.5 rounded border",
                                meta.color,
                                meta.bg,
                                meta.border
                              )}
                            >
                              {meta.label}
                            </span>
                            <span
                              className={cn(
                                "font-medium text-[var(--color-fg)] leading-snug",
                                isOverview ? "text-base" : "text-[13.5px]"
                              )}
                            >
                              {it.title}
                            </span>
                          </div>
                          {it.notation && (
                            <div className="pl-0.5 pt-0.5">
                              <NotationRenderer text={it.notation} size="sm" />
                            </div>
                          )}
                          <p
                            className={cn(
                              "leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap",
                              isOverview ? "text-[13px]" : "text-[12.5px]"
                            )}
                          >
                            {it.content}
                          </p>
                          {target.mode === "character" && it.type === "combo" && it.notation && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                promoteToComboLibrary(i);
                              }}
                              className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] hover:underline mt-1"
                            >
                              + aggiungi alla combo library
                            </button>
                          )}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {error && <ErrorBox>{error}</ErrorBox>}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStage("compose")}
                  className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  ← Indietro
                </button>
                <button
                  onClick={save}
                  className="px-5 py-2 rounded-md text-xs uppercase tracking-[0.2em] font-medium transition-all bg-[var(--color-accent)] text-[var(--color-bg)] hover:brightness-110"
                >
                  Salva {accepted.filter(Boolean).length} →
                </button>
              </div>
            </div>
          )}

          {stage === "saving" && (
            <div className="py-16 text-center">
              <div className="text-sm text-[var(--color-fg-muted)]">Salvataggio…</div>
            </div>
          )}

          {stage === "done" && (
            <div className="py-16 text-center space-y-2">
              <div className="text-3xl text-[var(--color-accent)]">✓</div>
              <div className="text-sm text-[var(--color-fg)]">Salvato.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({
  active,
  done,
  children,
}: {
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "transition-colors",
        active ? "text-[var(--color-accent)]" : done ? "text-[var(--color-fg-muted)]" : "text-[var(--color-fg-dim)]"
      )}
    >
      {children}
    </span>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 px-3 py-2 rounded leading-relaxed">
      {children}
    </div>
  );
}
