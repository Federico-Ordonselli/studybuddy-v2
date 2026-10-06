# Contesto per Claude Code

Questo è lo scaffold pulito di **StudyBuddy v2**. Architettura già decisa; da qui si costruisce.

## Principi
- **Local-first**: default tutto su Ollama. L'API (Anthropic/OpenAI-compat) è opt-in per-task in `src/lib/config.ts`, mai una dipendenza.
- **Modulare**: la logica sta in `src/lib/*`; le route in `src/app/api/*` sono thin wrapper.
- **Provider-agnostico**: ogni chiamata LLM passa da `generate(task, opts)` / `embed(texts)` in `src/lib/providers`. Non chiamare i provider direttamente dalle feature.

## Sorgente dati: corso Coursera scaricato
L'input principale è un **corso Coursera scaricato** (cartella `corso/modulo/lezione/` con file misti):
- `.srt`/`.vtt` = **trascrizioni**, fonte primaria. Già testo pulito → niente Whisper. Parser fatto in `src/lib/rag/sources/coursera.ts` (`parseSubtitles`), chunking con timestamp via `chunkTranscript`.
- `.pdf` = slide/readings → estratto con **unpdf** (`parsePdf`, pdfjs, no native deps).
- `.html` = letture → estratto con **node-html-parser** (`parseHtml`: `<co-content>` o fallback `<body>`, tiene code/pre/tabelle, scarta script/style/chrome).
- `.mp4`/`.mkv` = saltati di default (la trascrizione copre il testo); si tiene il path per il link al video. Con `--whisper` i video **senza** .srt/.vtt vengono trascritti (fallback #8).

Mappatura: corso → un **dominio**; ogni file testuale → un **documento** con `meta` { course, module, lesson, crumbs, path, fileHash }. `crumbs` è la breadcrumb completa (robusta alla profondità del path). I chunk di trascrizione portano `meta` { startSec, endSec } per citazioni cliccabili al minuto del video.
`ingestCourse(courseDir, domainId)` fa il walk + ingestione end-to-end (transcript/text pronti).

Attenzione ai **duplicati** slide-PDF vs trascrizione: stesso contenuto da due fonti → il reranker deve dedup-are.

## Stato attuale (fatto)
- Provider layer: Ollama (chat+embed), Anthropic (chat), OpenAI-compatible (chat+embed).
- RAG: chunking testo + trascrizioni, indicizzazione su sqlite-vec (con meta per-chunk), **hybrid search** (dense sqlite-vec + sparse BM25/FTS5, fusi via RRF), **rerank cross-encoder reale** (bge-reranker-v2-m3 via Transformers.js/ONNX, in-process; fallback LLM listwise), pipeline `retrieve()`.
- Ingestion Coursera: walker + parser srt/vtt + **pdf (unpdf) + html (node-html-parser, `<co-content>`/body)**, `ingestCourse()` con dedup (skip `.txt` gemello dell'srt + dedup chunk identici). CLI `npm run ingest -- <dir> <dominio>`.
- Tutor: SM-2, generazione quiz (structured output), grading LLM-as-judge, turni socratic/quiz/review.
- DB: schema Drizzle (domains, documents+meta, chunks+meta, cards, sessions).
- Route: `/api/ingest`, `/api/chat` (citazioni + `domainId` + `sessionId`), `/api/domains`, `/api/video` (stream mp4 con Range, validato sui sorgenti ingeriti), `/api/cards` (genera carte), `/api/review` (GET coda due / POST grading+SM-2), `/api/session` (ripresa).
- UI (`app/page.tsx`, client): selettore dominio + modalità **socratico/quiz/ripasso**, thread chat, citazioni cliccabili → player al minuto del video, quiz con opzioni mcq + grading, vista ripasso SM-2 (genera carte → coda due → valuta → riprogramma).
- Retrieval scopabile per dominio (`retrieve(query, domainId)`); citazioni in `rag/pipeline.ts` (`toCitations`).
- Persistenza: carte SM-2 in `tutor/cards.ts` (generate/dueCount/nextDueCard/reviewCard); sessione socratica in `tutor/sessions.ts` (history in `sessions.state`, ripresa via `sessionId` salvato in localStorage).
- Studio: riassunti map-reduce (`lib/summarize.ts`, per argomento o modulo), mappe concettuali (`lib/conceptmap.ts`, nodi/archi → SVG radiale in UI), slide con immagini (`lib/slides.ts` + `providers/image.ts`). Immagini = **SVG generate dall'LLM** (`backend svg-llm`, `think:false`), pluggable verso `automatic1111`/`openai`. Route: `/api/summarize`, `/api/conceptmap`, `/api/slides` (deck veloce), `/api/slides/image` (immagine lazy per-slide). UI = tab **Studio**.

## TODO prioritari (cercare i marcatori `TODO(claude-code)`)
1. ✅ **Smoke test** dello scaffold (install nativi, typecheck, una /api/ingest + /api/chat).
2. ✅ **Ingestion Coursera end-to-end** — parser PDF/HTML, CLI `npm run ingest`, dedup srt/txt + chunk. Re-ingest **idempotente** (upsert per `source` via `meta.fileHash`: file invariati saltati, modificati sostituiti). `meta.crumbs` = breadcrumb completa indipendente dalla profondità del path.
3. ✅ **UI** — chat tutor, selettore dominio/modalità, link al minuto del video dalle citazioni, quiz+grading, vista ripasso SM-2.
4. ✅ **Reranker reale** — cross-encoder `bge-reranker-v2-m3` (Transformers.js/ONNX, in-process) in `rag/reranker.ts`; dispatch + fallback LLM in `rag/rerank.ts`. Strategia/dtype in `config.reranker`.
5. ✅ **Riassunti** — `summarize` map-reduce (argomento/modulo). + **mappe concettuali** e **slide con immagini SVG generate** (tab Studio).
6. ✅ **Persistenza sessione** — history socratica in `sessions.state` (ripresa via `sessionId`); coda carte SM-2 in modalità review (`tutor/cards.ts`).
7. ✅ **Hybrid search** — BM25 via FTS5 affiancato al dense, fusione RRF in `rag/pipeline.ts` (`hybridSearch`). FTS in `rag/store.ts` (`ftsSearch`, sync in indexChunks/delete, backfill `reindexFts`). On/off + `rrfK` in `config.rag`.
8. ✅ **Whisper fallback** — trascrive i video senza .srt/.vtt via sidecar (`lib/transcribe.ts` + `scripts/whisper_sidecar.py`), backend auto-detect (faster-whisper/whisper.cpp/openai-whisper), output SRT → riusa `parseSubtitles`. Opt-in con `npm run ingest -- … --whisper`; doc come `kind:transcript` con link al video. Config in `config.whisper`.

## Note tecniche
- `better-sqlite3`, `sqlite-vec` e `@huggingface/transformers`/`onnxruntime-node` sono nativi/non-bundlabili → in `serverExternalPackages` (next.config.ts). Le route che li usano hanno `runtime = "nodejs"`.
- Reranker cross-encoder: il modello (~560MB, dtype `q8`) si scarica una volta in `.models/` (gitignored) e si carica lazy come singleton al primo rerank. Per ridurre il footprint si può abbassare `config.reranker.dtype` (es. `int8`/`q4`).
- Embedding dim = 1024 (`EMBED_DIM` in config.ts). Se cambi modello embed, aggiorna sia `EMBED_DIM` sia la virtual table (re-index).
- `sqlite-vec` (questa build) è severo: la PK `chunk_id` di `vec0` va passata come **BigInt** (`BigInt(id)`), e le query KNN con JOIN richiedono `AND k = ?` (il `LIMIT` non basta). Vedi `rag/store.ts`.
- FTS5: tabella `chunks_fts` con **`rowid` = chunk id** (così è in sync col dense e si cancella per rowid). Tokenizer `porter unicode61 remove_diacritics 2` (EN/IT). `ensureFts()` fa backfill una-tantum se vuota; indexChunks/deleteDocumentChunks la tengono sincronizzata.
- Structured output: Ollama accetta `format` come JSON schema; il provider lo passa quando `opts.schema` è presente.
- gpt-oss è un modello "reasoning": per output diretti (es. SVG) usa `opts.think:false` nel provider Ollama, altrimenti la catena di reasoning consuma `maxTokens` e tronca l'output. La generazione SVG ha anche un retry prima del placeholder.
- Immagini slide: `config.image.backend` (`svg-llm` default locale; `automatic1111`/`openai` opt-in). Le SVG vengono sanificate (via `sanitizeSvg`: rimozione `<script>`/handler, auto-close se troncate).
- Whisper: sidecar Python in `.venv` (faster-whisper installato; `transcribe.ts` usa `.venv/bin/python` se presente). GPU richiede cuBLAS/cuDNN per ctranslate2: senza, il sidecar fa **fallback automatico su CPU/int8** (base ~7s per 4 min di video). Re-ingest non ri-trascrive (idempotenza per `fileHash` del .mp4).
- Re-ingest idempotente per `fileHash`: se migliori un parser in `sources/coursera.ts` i file invariati verrebbero saltati → **bumpa `PARSER_VERSION`** per forzare il refresh.

## Comandi
`npm run dev` · `npm run ingest -- <dir> <dominio>` · `npm run db:push` · `npm run db:studio` · `npm run typecheck`
