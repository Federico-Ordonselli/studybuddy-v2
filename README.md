# StudyBuddy v2

Companion di studio **local-first** con RAG: ingerisce un corso Coursera scaricato
(trascrizioni .srt/.vtt, PDF, HTML), recupera i passaggi pertinenti, fa da tutor socratico
con citazioni al minuto del video, genera quiz, riassunti map-reduce, **mappe concettuali** e
**slide con immagini generate** (SVG locali), e schedula il ripasso con SM-2.

Rebuild di StudyBuddy v1 (Streamlit + qwen2.5:14b + ChromaDB) su stack moderno e modulare.

## Stack
- **Next.js 15** (App Router) + TypeScript
- **SQLite + Drizzle** per i dati relazionali
- **sqlite-vec** come vector store (niente servizio esterno)
- **Ollama** per l'inference locale; provider layer pluggabile (Anthropic / OpenAI-compatible opzionali)

## Modelli (default, per 16GB VRAM — RTX 4080 Super)
Configurati in `src/lib/config.ts`, uno per task:
- chat / summarize / quiz / grade → `gpt-oss:20b`
- embed → `bge-m3` (multilingue IT/EN, 1024-dim)
- rerank → cross-encoder `bge-reranker-v2-m3` (Transformers.js/ONNX, in-process; fallback listwise LLM)

Cambiare provider di un task = una riga in `config.ts`. L'API di Anthropic NON è inclusa nel
piano Pro: va pagata a consumo dalla Console (resta opt-in).

## Setup
```bash
# 1. modelli locali
ollama pull gpt-oss:20b
ollama pull bge-m3

# 2. dipendenze
npm install

# 3. env + db
cp .env.example .env
npm run db:push

# 4. dev
npm run dev
```

## Ingestion di un corso Coursera
Indicizza una cartella scaricata (corso/modulo/lezione con .srt/.vtt, .html, .pdf):
```bash
# punta a un singolo corso per avere module/lesson puliti dal path
npm run ingest -- "Courses/Meta Front-End Developer/Introduction-to-version-control" "Version Control"
```
Salta i `.mp4` (la trascrizione copre il testo) e i `.txt` gemelli dell'`.srt`;
dedup-a i chunk con contenuto identico (es. stessa reading come html e pdf).

Per trascrivere i (pochi) video **senza** `.srt`/`.vtt`, aggiungi `--whisper` (richiede un
backend: `faster-whisper` nel `.venv`, oppure `whisper.cpp`/`openai-whisper` nel PATH):
```bash
npm run ingest -- "Courses/Meta Front-End Developer/Introduction-to-version-control" "Version Control" --whisper
```

## API (per provare lo scaffold)
```bash
# indicizza testo
curl -X POST localhost:3000/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"title":"Capitolo 1","text":"...testo lungo..."}'

# turno tutor socratico
curl -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"mode":"socratic","message":"spiegami i transformer"}'
```

## Struttura
```
src/lib/
  config.ts          # routing modello-per-task
  db/                # drizzle schema + client sqlite-vec
  providers/         # ollama | anthropic | openai-compatible (interfaccia comune)
  rag/               # chunk → embed/store → retrieve → rerank → pipeline
  tutor/             # sm2 | quiz | grade | session (macchina a stati)
src/app/
  api/ingest, api/chat
```

Vedi `CLAUDE.md` per il roadmap dei prossimi passi.
