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

**Cartella-libreria**: i corsi si copiano a mano in `Courses/` (override `STUDYBUDDY_LIBRARY_DIR`, `lib/libraryDir.ts`) e si importano da `/add`. Ogni sottocartella è un elemento: **macro** se la maggioranza delle sue sottocartelle con materiale ha nomi non numerati (corsi di una specializzazione), **corso** se sono numerate (moduli `01_…`) — `classifyFolder` in `lib/ingestPlan.ts`, correggibile nell'anteprima. Gerarchia a 2 livelli macro → corsi (`resolveScope`); i **domini** (tabella `areas`, slug in `domains.areas`) sono solo organizzazione, gestiti in `/settings`.

Mappatura: corso → un **dominio**; ogni file testuale → un **documento** con `meta` { course, module, lesson, crumbs, path, fileHash }. `crumbs` è la breadcrumb completa (robusta alla profondità del path). I chunk di trascrizione portano `meta` { startSec, endSec } per citazioni cliccabili al minuto del video.
`ingestCourse(courseDir, domainId)` fa il walk + ingestione end-to-end (transcript/text pronti).

Attenzione ai **duplicati** slide-PDF vs trascrizione: stesso contenuto da due fonti → il reranker deve dedup-are.

## Stato attuale (fatto)
- Provider layer: Ollama (chat+embed), Anthropic (chat), OpenAI-compatible (chat+embed).
- RAG: chunking testo + trascrizioni, indicizzazione su sqlite-vec (con meta per-chunk), **hybrid search** (dense sqlite-vec + sparse BM25/FTS5, fusi via RRF), **rerank cross-encoder reale** (bge-reranker-v2-m3 via Transformers.js/ONNX, in-process; fallback LLM listwise), pipeline `retrieve()`.
- Ingestion Coursera: walker + parser srt/vtt + **pdf (unpdf) + html (node-html-parser, `<co-content>`/body)**, `ingestCourse()` con dedup (skip `.txt` gemello dell'srt + dedup chunk identici). CLI `npm run ingest -- <dir> <dominio>`.
- Tutor: SM-2, generazione quiz (structured output), grading LLM-as-judge, turni socratic/quiz/review.
- DB: schema Drizzle (domains, documents+meta, chunks+meta, cards, sessions).
- Route: `/api/ingest`, `/api/chat` (citazioni + `domainId` + `sessionId`), `/api/library` (organizzazione: rinomina/sposta/domini/macro), `/api/areas` (domini: crea/rinomina/ordina/elimina), `/api/ingest-folder` (+ `/analyze`, import con anteprima), `/api/fs` (browser cartelle in sandbox), `/api/video` (stream mp4 con Range, validato sui sorgenti ingeriti), `/api/cards` (genera carte), `/api/review` (GET coda due / POST grading+SM-2), `/api/session` (ripresa), `/api/health` (stato DB/Ollama/reranker/Whisper; `?warm=1` carica il reranker e fa un'inferenza di prova).
- UI a pagine: **Libreria** `/` (Server Component: card macro/corsi raggruppate per **dominio**, filtro, banner dei corsi nuovi trovati nella cartella-libreria, organizzazione manuale via `/api/library`), **area studio** `/study/[id]?mode=tutor|quiz|review|studio` (`components/study/*`: breadcrumb, cambio corso, citazioni → video al minuto, quiz, ripasso SM-2, Studio), **Aggiungi** `/add` (analisi della cartella-libreria → anteprima modificabile → import con progresso). Stile e palette condivisi con `learning-vault` (Tailwind v4, font `@fontsource-variable/*`); le viste di studio usano ancora stili inline con gli alias `--panel`/`--accent`… definiti in `globals.css`. **Impostazioni** `/settings`: gestione dei domini e stato (DB/Ollama/reranker/Whisper da `/api/health`).
- Retrieval scopabile per dominio (`retrieve(query, domainId)`); citazioni in `rag/pipeline.ts` (`toCitations`).
- Persistenza: carte SM-2 in `tutor/cards.ts` (generate/dueCount/nextDueCard/reviewCard); sessione socratica in `tutor/sessions.ts` (history in `sessions.state`, ripresa via `sessionId` salvato in localStorage).
- Studio: riassunti map-reduce (`lib/summarize.ts`, per argomento o modulo), **mappe concettuali esplorabili** (vedi sotto), slide con immagini (`lib/slides.ts` + `providers/image.ts`). Immagini = **SVG generate dall'LLM** (`backend svg-llm`, `think:false`), pluggable verso `automatic1111`/`openai`. Route: `/api/summarize`, `/api/maps*`, `/api/slides` (deck veloce), `/api/slides/image` (immagine lazy per-slide). UI = tab **Studio**.
- Mappe concettuali (ex progetto `studio-mappe`, integrato): bolle annidate in cui si **entra** (doppio clic/Invio, zoom animato; Esc o «↑ Esci» per risalire). Nucleo puro JS in `lib/mappe/` (formato v1 validato, comandi atomici, sessione undo/redo, `proposte.js` = proposta LLM → comandi), DOM in `components/mappe/` (`tela.js`, `editor.js`, host React `MapStudio.tsx`). Persistenza in tabella `concept_maps` (doc JSON + revisione, conflitto = 409). Generazione in `lib/conceptmap.ts`: `generateMap` (centro + rami) e `expandConcept` (sotto-concetti quando entri in un livello vuoto, riusa i titoli già in mappa → collegamenti fra livelli). Relazioni verso altri livelli = pillole "portale" sulla tela; titoli di altri concetti nel testo della scheda = link; `sourceRefs` → `/api/maps/source` (video al minuto).

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
- Stack (ott 2026): Next 16 (Turbopack di default, `src/proxy.ts` al posto di middleware, niente `next lint`), React 19.3, TypeScript 7 (tsc nativo, usato anche da `next build`), drizzle-orm 0.45, better-sqlite3 13, node-html-parser 9, @anthropic-ai/sdk 0.131.
- Turbopack traccia staticamente i path costruiti da `process.cwd()`: per file runtime fuori dal bundle (es. `.venv/bin/python` in `transcribe.ts`) usare `path.resolve(/* turbopackIgnore: true */ process.cwd(), …)`, altrimenti la build fallisce (symlink fuori root).
- `better-sqlite3`, `sqlite-vec` e `@huggingface/transformers`/`onnxruntime-node` sono nativi/non-bundlabili → in `serverExternalPackages` (next.config.ts). Le route che li usano hanno `runtime = "nodejs"`.
- Reranker cross-encoder: modello scaricato una volta in `.models/` (gitignored), caricato lazy come singleton. **GPU di default** (`device: cuda`, `dtype: fp16`, ~0.6s/20 chunk), fallback automatico su CPU (`cpuDtype: q8`, ~3.4s). Batch da 8 e `maxLength` 512 (senza troncamento il padding esplodeva: ~13s e 13GB RAM). Su GPU non usare q8: gli operatori interi non hanno kernel CUDA e tornano su CPU.
- onnxruntime-node 1.30 usa **CUDA 13** (lib di sistema; in Docker quelle dell'immagine `nvidia/cuda:13.0.2-cudnn-runtime`). Le lib CUDA 12 + cuDNN 9 nella `.venv` (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) servono solo a ctranslate2/Whisper: `whisperEnv()` in `transcribe.ts` le mette nel `LD_LIBRARY_PATH` del **sottoprocesso Python**, mai di Node (stesso soname `libcudnn.so.9`: davanti a Node farebbero caricare a onnxruntime il cuDNN sbagliato).
- Modelli (ott 2026, scelti con un bake-off su tutor/quiz/grading): chat/quiz/grade/summarize = `gemma4:12b`, embed = `qwen3-embedding:0.6b` (multilingue: domande IT su materiale EN). Richiede Ollama ≥ 0.35.
- Embedding dim = 1024 (`EMBED_DIM` in config.ts). Se cambi modello embed, aggiorna `EMBED_DIM` e **re-indicizza su un DB nuovo**: l'ingest idempotente per `fileHash` salterebbe i file invariati lasciando i vettori del vecchio modello (risultati sbagliati senza errori).
- DB: percorso da `DB_PATH` in `.env.local` (oggi `studybuddy-v2.db`; `studybuddy.db` è il vecchio backup bge-m3). Next lo legge da solo; CLI `ingest` (tsx `--env-file-if-exists`) e `drizzle.config.ts` (`process.loadEnvFile`) sono allineati.
- `sqlite-vec` (questa build) è severo: la PK `chunk_id` di `vec0` va passata come **BigInt** (`BigInt(id)`), e le query KNN con JOIN richiedono `AND k = ?` (il `LIMIT` non basta). Vedi `rag/store.ts`.
- FTS5: tabella `chunks_fts` con **`rowid` = chunk id** (così è in sync col dense e si cancella per rowid). Tokenizer `porter unicode61 remove_diacritics 2` (EN/IT). `ensureFts()` fa backfill una-tantum se vuota; indexChunks/deleteDocumentChunks la tengono sincronizzata.
- Structured output: Ollama accetta `format` come JSON schema; il provider lo passa quando `opts.schema` è presente.
- I modelli recenti sono "reasoning": con il thinking attivo `num_predict` si esaurisce prima della risposta (output vuoto). Per questo `config.ollama.think = false` di default (opt-in per chiamata con `opts.think`). `config.ollama.numCtx` = 16k: il default Ollama (4096) tronca in silenzio il contesto RAG.
- Grading: un giudizio non valido (dopo un retry) **lancia** invece di restituire quality 0, che per SM-2 azzererebbe la carta.
- Immagini slide: `config.image.backend` (`svg-llm` default locale; `automatic1111`/`openai` opt-in). Le SVG sono mostrate come `<img>` data URL (niente script per costruzione), quindi devono essere XML ben formato: `sanitizeSvg` aggiunge `xmlns` e ripara attributi duplicati / `&` nude.
- Sicurezza (app locale che espone il filesystem): `src/proxy.ts` (ex middleware, Next 16) su `/api/*` accetta solo host locali (DNS rebinding/LAN; override `STUDYBUDDY_ALLOWED_HOSTS`) e scritture `application/json` (CSRF). I percorsi dal client passano dalla sandbox `lib/fsRoot.ts` (home, override `STUDYBUDDY_FS_ROOT`).
- Whisper: sidecar Python in `.venv` (faster-whisper installato; `transcribe.ts` usa `.venv/bin/python` se presente). GPU richiede cuBLAS/cuDNN per ctranslate2: senza, il sidecar fa **fallback automatico su CPU/int8** (base ~7s per 4 min di video). Re-ingest non ri-trascrive (idempotenza per `fileHash` del .mp4).
- Mappe: `tela.js` riconosce tap/doppio tap al `pointerup` perché con `setPointerCapture` sullo SVG i `dblclick` arrivano allo SVG, non alla bolla (era il motivo per cui «entrare» non funzionava). Ogni passaggio RAG nei prompt delle mappe è tagliato a 2500 caratteri (rete di sicurezza: oggi i chunk sono ≤ ~2000).
- Chunking: `chunkText` spezza i paragrafi oltre budget (righe → frasi → taglio), perché `structuredText` dell'HTML separa i blocchi con un solo `\n` (prima una pagina = un chunk, fino a 270k). `parseHtml` parsa i `<pre>` (di default node-html-parser li lascia markup letterale) e toglie i `data:` URI con una scansione lineare: immagini base64 da 15 MB mandano in stack overflow le regex di V8.
- Re-ingest e carte: `deleteDocumentChunks` sgancia `cards.source_chunk_id` (FK) in una transazione; senza, il re-ingest dei documenti con carte falliva a metà.
- Re-ingest idempotente per `fileHash`: se migliori un parser in `sources/coursera.ts` i file invariati verrebbero saltati → **bumpa `PARSER_VERSION`** per forzare il refresh.
- Organizzazione: `lib/library.ts` valida gli invarianti (macro senza genitore, corsi solo dentro macro, elimina solo macro senza dati di studio propri, domini solo esistenti). Un dominio esistente cambia nome/macro/aree solo dalla Libreria o da un piano esplicito di `/add` (`parsePlan`/`applyPlan` in `lib/ingestTree.ts`): re-importare non disfa gli spostamenti manuali.
- `ingested_files` registra ogni file elaborato (anche senza chunk): l'analisi di `/add` confronta gli hash (`fileHashOf`, include `PARSER_VERSION`) per dire nuovo/aggiornato/modificato. Un import alla volta (`activeJob`, 409).
- **Non usare `npm run db:push` sul DB reale**: le tabelle virtuali `vec_chunks`/`chunks_fts` non sono nello schema Drizzle. Migrazioni = SQL esplicito dopo un backup; le aggiunte della Libreria (`domains.areas`, `ingested_files`) le applica da sé `ensureLibrarySchema()` all'apertura del DB (`lib/db/index.ts`, idempotente). DB nuovo: si crea da solo all'apertura (`initSchema()` da `lib/db/schemaSql.ts`, generato con `npm run db:schema`: rigeneralo quando cambi `schema.ts`, un test lo controlla).
- Domini (F2): tabella `areas` (slug PK fisso, nome, simbolo, tagline, `module` dal registro `lib/modules.ts`, `position`). `domains.areas` contiene **slug**: le API dei corsi rifiutano nomi e slug inesistenti, un dominio nuovo si crea con `POST /api/areas` (anche da `AreaInput`). `ensureHubSchema()` (in `lib/db/index.ts`, dopo `ensureLibrarySchema()`) crea la tabella sui DB esistenti con lo stesso SQL di `schemaSql.ts` e converte una volta i nomi liberi in slug (`Web`/`web` = un dominio), in transazione IMMEDIATE. `LibraryError` sta in `lib/errors.ts`.
- Test: `npm test` (`node:test` via tsx, DB temporaneo per file con `tests/helpers/db.ts`, nessuna dipendenza da Ollama). `learning-vault/` è escluso dal typecheck e i suoi dati sono gitignored.
- **Docker**: `docker compose up -d --build` (vedi README). `network_mode: host` (Ollama sull'host), `./data` per DB e cache modelli (`STUDYBUDDY_MODELS_DIR`, `HF_HOME`), corsi montati `:ro` allo stesso percorso dell'host (`COURSES_DIR`) così `documents.source` resta valido. `/api/health?warm=1` dice se il reranker è su `cuda` (dopo un'inferenza vera). Porta/indirizzo: `STUDYBUDDY_PORT`/`STUDYBUDDY_HOST` in `.env`. La CLI funziona anche nel container: `docker compose exec studybuddy npm run ingest -- <dir> <dominio>`.

## Comandi
`npm run dev` · `npm run ingest -- <dir> <dominio>` · `npm run db:schema` · `npm run db:push` · `npm run db:studio` · `npm run typecheck` · `npm test` · `docker compose up -d --build`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
