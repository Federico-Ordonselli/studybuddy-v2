# Full Studio dentro StudyBuddy — design

Data: 2026-11-02. Decisioni dell'utente in conversazione; le altre sono scelte di Claude (segnate *[scelta]*).

## Perché

Avere in **una sola app** la lezione audio (voce + codice/figure sincronizzati, il player di Full Studio) e
gli strumenti di studio (carte FSRS, quiz, tutor) sullo stesso materiale. Primo uso reale: il libro del
concorso INPS (capitoli Markdown trascritti dalle foto), ma l'app resta generica.

## Decisioni dell'utente

- Copione e audio restano **manuali, nella pipeline** di `Full_studio/` (copione scritto da Claude Code,
  audio con `tts.py`). Niente generazione di copione/audio in app, niente Ollama per questo.
- Carte e quiz **per sezione**, **già pronti** prima di ascoltare, scritti dal modello più forte disponibile:
  Claude Code, nella stessa passata del copione. Niente API a pagamento.
- La pool di carte e quiz dipende da **fin dove hai ascoltato**.
- StudyBuddy deve **ingerire i file `.md`** (generico, non solo Full Studio).
- **Pagina dedicata** a Full Studio.

## Obiettivi

1. `.md` come fonte di prima classe nell'ingest (`classify` → `markdown`), con il percorso dei titoli nel
   `meta` dei chunk.
2. **Pacchetto lezione** dentro la cartella di un corso: `studio/lesson.json` (+ `audio/`, `study.json`).
   L'ingest del corso lo registra; il pacchetto non genera chunk (il testo arriva dal `.md` o dall'HTML).
3. Pagina `/full-studio` (elenco lezioni con avanzamento) e `/full-studio/[id]` (player portato in React).
4. Carte per sezione importate **sospese** (bloccate) e sbloccate quando la sezione è ascoltata; quiz a
   scelta multipla per sezione con pool = sezioni ascoltate.
5. Contenuti per i 5 capitoli INPS (copione, carte, quiz, audio) prodotti nella pipeline.

## Non obiettivi

- Generazione di copione o audio dall'app; player audio sincronizzato con le citazioni RAG.
- Evidenziazione sintattica del codice (*[scelta]*: niente `shiki`, righe evidenziate sì; le figure INPS
  sono ASCII). Da aggiungere dopo se serve.
- Carte per le Parti 1–4 della guida full-stack (hanno già i quiz di capitolo, che entrano nella pool).

## Anti-obiettivi

- Carte di sezioni mai ascoltate che compaiono nel ripasso quotidiano.
- Testo indicizzato due volte (copione + fonte) → duplicati nel retrieval.
- Codice specifico per il concorso.

## Formato del pacchetto *[scelta]*

```
<corso>/<modulo>/Capitolo_01.md          ← fonte, ingerita come markdown
<corso>/<modulo>/studio/lesson.json      ← formato Full Studio invariato (chapters/sections/segments, codeBlocks, quiz)
<corso>/<modulo>/studio/study.json       ← facoltativo: { version: 1, sections: { "<sectionId>": { cards: [{q,a}], quiz: [{q,options,answer,why}] } } }
<corso>/<modulo>/studio/audio/partN/*.mp3 ← percorsi `segment.audio` relativi a studio/
```

`npm run prepare:full-studio -- --part <dir content/partN> --dest <cartella modulo>` copia questi file dalla
pipeline nella libreria (staging + rename; sostituisce solo la propria `studio/`). Il convertitore HTML di
oggi resta per le Parti 1–4 già importate; lo stesso comando può aggiungere `studio/` a quei moduli.

## StudyBuddy

**Ingest.** `classify`: `.md`/`.markdown` → `markdown` (`parseMarkdown`: frontmatter tolto, sezioni per
titolo, `chunkText` per sezione, `meta.section` = percorso dei titoli). `lesson.json` dentro una cartella
`studio/` → `studio`: registra/aggiorna la riga `studio_lessons` (dominio, percorso, titolo, conteggi) e
importa `study.json`. `PARSER_VERSION` → 5.

**Schema** (via `ensureHubSchema`, idempotente; `schemaSql.ts` rigenerato):
- `studio_lessons(id, domain_id → domains, path UNIQUE, title, sections, duration, created_at)`.
- `studio_progress(lesson_id PK → studio_lessons ON DELETE CASCADE, state JSON, updated_at)`:
  `{ segmentId, offset, rate, completedSections: string[] }`.
- `cards.studio_section TEXT` = `"<lessonId>:<sectionId>"`, null per le carte normali.
- `studio_quiz(lesson_id, section_id, ordinal, question JSON)`: domande della sezione (study.json) e del
  capitolo (lesson.json, legate all'ultima sezione del capitolo).

**Blocco.** Le carte importate nascono `suspended = 1` se la sezione non è completata. Completare una sezione
(fine dell'ultimo segmento, o «Segna come ascoltata») → `POST /api/studio/progress` → `suspended = 0` per le
sue carte. Le query del ripasso non cambiano. Una sezione completata non torna bloccata. Re-import: duplicati
saltati da `saveCards`.

**Quiz.** `GET /api/studio/quiz?lesson=&n=10` (*[scelta]*): pool = domande delle sezioni completate; metà dalle
ultime due sezioni completate, il resto casuale; ordine delle opzioni rimescolato. Correzione nel browser
(risposta e spiegazione arrivano con la domanda: è un esercizio, non un esame). Niente FSRS sul quiz.

**Audio.** `GET /api/studio/audio?lesson=<id>&file=<path>`: path risolto dentro `studio/` della lezione
registrata (niente `..`, solo `.mp3`), Range come `/api/video`.

**UI.** Voce «Full Studio» nella sidebar. `/full-studio`: lezioni per corso, sezioni ascoltate / totali,
carte sbloccate. `/full-studio/[id]`: indice (capitoli/sezioni, stato), testo del segmento, pannello
codice/visual, barra di controllo (play, ±segmento, ±sezione, velocità 0.75–2), scorciatoie da tastiera
(spazio, frecce, `[`/`]`), azioni «Quiz su ciò che hai ascoltato» e «Ripassa le carte» (→ `/study/<corso>?mode=review`).
Logica del player (reducer, flatten, controller A/B) portata da `Full_studio/app/src/player`, con test.
Colori solo dai token (`color-boss`).

## Pipeline (in `Full_studio/`, fuori da Git di StudyBuddy)

Per ogni capitolo INPS: `parse.py --part N` → copione `script/chNN.txt` scritto da Claude Code
(regole di `docs/PROMPT.md`, figure ASCII come `[code]`) → `build_lesson.py` → `study.json` scritto da Claude
Code (3–6 carte e 2–4 domande per sezione, controllate con `checkCard`) → `tts.py` → `validate.py` →
`prepare:full-studio` nella cartella del corso INPS in `Courses/`. Import da `/corsi/add` (lo fa l'utente:
tocca il DB reale).

## Lasciato a chi costruisce

Layout preciso del player, testi dell'interfaccia, pesi della pool, dettagli di `parseMarkdown`.
