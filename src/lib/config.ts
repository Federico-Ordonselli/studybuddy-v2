/**
 * Central model routing. Ogni TASK punta a un provider + modello.
 * Cambiare backend di un task = cambiare una riga qui.
 *
 * Local-first: tutto su Ollama di default. Per mandare un singolo task
 * pesante all'API (es. summarize), basta cambiare provider in "anthropic".
 */
export type ProviderName = "ollama" | "anthropic" | "openai-compatible";

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

export type Task =
  | "chat"       // tutor conversazionale
  | "summarize"  // riassunti di capitoli/trascrizioni
  | "quiz"       // generazione domande (structured output)
  | "grade"      // LLM-as-judge sulle risposte aperte
  | "embed"      // embeddings per il retrieval
  | "rerank"     // reranking dei chunk recuperati
  | "extract";   // estrazione strutturata da trascrizioni (modulo SF6)

export const models: Record<Task, ModelRef> = {
  chat:      { provider: "ollama", model: "gemma4:12b" },
  summarize: { provider: "ollama", model: "gemma4:12b" },
  quiz:      { provider: "ollama", model: "gemma4:12b" },
  grade:     { provider: "ollama", model: "gemma4:12b" },
  embed:     { provider: "ollama", model: "qwen3-embedding:0.6b" },
  rerank:    { provider: "ollama", model: "gemma4:12b" }, // listwise via LLM (vedi rag/rerank.ts)
  extract:   { provider: "ollama", model: "gemma4:12b" },
};

/**
 * Opzioni runtime per Ollama.
 *  - `numCtx`: finestra di contesto. Il default di Ollama (4096) tronca in silenzio
 *    l'inizio del prompt, cioè proprio il contesto RAG.
 *  - `think`: i modelli recenti sono "reasoning" di default; con il thinking attivo
 *    il budget `num_predict` può esaurirsi prima della risposta (output vuoto).
 *    Default false; una singola chiamata può riattivarlo con `opts.think`.
 */
export const ollama = {
  numCtx: 16384,
  headersTimeoutMs: 30 * 60_000,
  bodyTimeoutMs: 30 * 60_000,
  think: false,
};

/** Dimensione dell'embedding del modello in `models.embed`. qwen3-embedding:0.6b = 1024. */
export const EMBED_DIM = 1024;

/**
 * Reranker. `cross-encoder` = bge-reranker-v2-m3 reale via Transformers.js/ONNX,
 * in-process e local-first (modello scaricato una volta in `cacheDir`). Con
 * `llm` si usa il rerank listwise via `models.rerank` (fallback automatico se il
 * cross-encoder fallisce a caricarsi).
 *
 * `device: "cuda"` usa la GPU con `dtype` fp16 (~0.6s per 20 chunk); se CUDA non si
 * carica si ripiega su CPU con `cpuDtype` q8 (~3.4s). Su GPU i pesi q8 sono lenti:
 * molti operatori interi non hanno kernel CUDA e tornano su CPU.
 * onnxruntime-node 1.30 usa CUDA 13 (lib di sistema, o dell'immagine Docker). Le lib
 * CUDA 12 + cuDNN 9 della .venv servono solo a ctranslate2 (Whisper): le vede solo il
 * sottoprocesso Python (`whisperEnv` in transcribe.ts), mai il processo Node.
 */
export const reranker = {
  strategy: "cross-encoder" as "cross-encoder" | "llm",
  model: "onnx-community/bge-reranker-v2-m3-ONNX",
  device: "cuda" as "cuda" | "cpu",
  dtype: "fp16" as "q8" | "int8" | "fp16" | "fp32",
  cpuDtype: "q8" as "q8" | "int8" | "fp16" | "fp32",
  batchSize: 8,   // coppie per forward: limita il picco di memoria
  maxLength: 512, // token per coppia (query+testo); oltre si tronca
  cacheDir: process.env.STUDYBUDDY_MODELS_DIR ?? ".models", // in Docker: /app/data/models
};

/**
 * Generazione immagini per le slide. Pluggable e local-first.
 *  - `svg-llm` (default): illustrazioni SVG diagrammatiche generate da gpt-oss, in
 *    locale, zero infra. `automatic1111`/`openai` sono predisposti ma opt-in.
 */
export const image = {
  backend: "svg-llm" as "svg-llm" | "automatic1111" | "openai",
  baseUrl: process.env.SD_BASE_URL ?? "http://localhost:7860", // per automatic1111
  model: "gpt-image-1",                                         // per openai
};

/**
 * Whisper fallback: trascrive i (pochi) video senza .srt/.vtt, via sidecar locale.
 * `backend: "auto"` rileva faster-whisper → whisper.cpp → openai-whisper; se nessuno
 * è installato l'ingest salta i video (no-op). Attivo solo con `--whisper` nella CLI.
 */
export const whisper = {
  lockWaitMs: Number(process.env.WHISPER_LOCK_WAIT_MS ?? 30 * 60_000), // attesa massima ingest
  backend: "auto" as "auto" | "faster-whisper" | "whisper.cpp" | "openai-whisper",
  model: process.env.WHISPER_MODEL ?? "base", // tiny|base|small|medium|large-v3
  language: process.env.WHISPER_LANG || undefined, // es. "en"; undefined = auto-detect
  cppBinary: process.env.WHISPER_CPP_BIN ?? "whisper-cli", // per whisper.cpp
  cppModel: process.env.WHISPER_CPP_MODEL ?? "", // path al .bin (whisper.cpp)
};

/** Parametri RAG di default. */
export const rag = {
  chunkTokens: 500,
  chunkOverlap: 80,
  topK: 20,        // candidati dal retrieval (per ramo: dense e sparse)
  topN: 6,         // chunk tenuti dopo il rerank
  hybrid: true,    // fonde dense (sqlite-vec) + sparse (BM25/FTS5) via RRF
  historyTurns: 8,
  historyChars: 12000,
  retrievalExcerptChars: 600,
  dedupThreshold: 0.6,
  rrfK: 60,        // costante della Reciprocal Rank Fusion
};
