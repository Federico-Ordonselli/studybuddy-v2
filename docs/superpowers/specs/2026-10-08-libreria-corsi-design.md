# Libreria corsi: pagine, import con anteprima, aree — design

Data: 2026-10-08 · Stato: approvato in conversazione, da rivedere per iscritto

## Obiettivo

Oggi StudyBuddy sembra "l'app del corso che c'è dentro": una pagina sola con un `<select>` di domini, nessun modo di aggiungere materiale dalla UI (il messaggio vuoto dice `npm run ingest`), e la gerarchia specializzazione → corsi (che il DB ha già) si vede solo come un `↳` nel menu.

Risultato voluto:

1. una **Libreria** che mostra tutti i corsi, raggruppati in modo leggibile;
2. un flusso **Aggiungi corso** dalla UI che **analizza una cartella** e mostra un'anteprima modificabile prima di importare;
3. due livelli di organizzazione distinti:
   - **gerarchia vera** (2 livelli): *macro → corsi*. Legame semantico: studiare un macro = studiare tutti i suoi corsi (retrieval, ripasso, mappe);
   - **aree** (tag): solo layout. Raggruppano a colpo d'occhio (es. "Web" contiene sia la specializzazione Front-End sia un corso Back-End) ma **non** collegano i contenuti: il tutor del Front-End non pesca dal Back-End.

Vincolo permanente: l'app deve restare generica, nessun codice/prompt/UI pensato per un corso specifico.

## Contesto: learning-vault

L'utente ha un secondo progetto, `learning-vault` (hub personale: aree di interesse fisse come TFT/SF6/Chitarra/Data, quick capture di note, SF6 costruito). In futuro StudyBuddy potrebbe diventare il modulo "corsi" del vault. **Questa spec non fa l'unione** (sotto-progetto successivo con la sua spec: un'app, un DB, Docker + GPU), ma la prepara:

- le **aree** di StudyBuddy sono lo stesso concetto dei domini del vault (stringhe, nessun effetto semantico) → mapping uno-a-uno all'unione;
- le nuove pagine adottano il **linguaggio visivo del vault** (palette nero caldo + ambra, Fraunces per i titoli, Geist per il testo, JetBrains Mono per i numeri) e **Tailwind v4** come il vault, così il codice si porta senza riscriverlo;
- la shell a sidebar del vault arriva con l'unione: qui resta il layout Libreria + area studio scelto.

`learning-vault/` non va committato nel repo StudyBuddy (pubblico): contiene il DB personale e impostazioni locali.

## Fuori scope

- Eliminare un corso dal DB (tocca chunk, vettori, FTS, carte, mappe: passo a parte).
- Annidamento oltre 2 livelli.
- Unione con learning-vault.
- Cambi alla logica di studio (tutor, quiz, SM-2, mappe, slide): si spostano, non cambiano.

## 1. Modello dati

Nessuna tabella nuova.

- **`domains.areas`**: colonna JSON `string[]`, default `[]`. Letta solo dalla Libreria. Retrieval, ripasso, mappe non la leggono mai.
- **Macro manuale**: riga `domains` con `kind = "macro"`, `path = null`.
- **Regola di non-sovrascrittura**: l'upsert per `path` (oggi `upsertDomain` in `lib/ingestTree.ts`) **non modifica** `name`, `kind`, `parentId`, `areas` di un dominio già esistente. Solo un piano esplicito dall'anteprima o un'azione in Libreria li cambiano. Vale anche per la CLI `npm run ingest`: la struttura dedotta dalle cartelle si applica solo ai domini nuovi.
- **Invarianti** (validati server-side in `lib/library.ts`, errore 400 leggibile):
  - i documenti stanno solo su domini `course`;
  - un `macro` non ha genitore; il genitore di un `course` è `null` o un `macro` → niente cicli, 2 livelli;
  - si può eliminare solo un `macro`; i suoi corsi diventano sciolti. Eliminazione **bloccata** se il macro ha carte, mappe o sessioni proprie (messaggio che lo spiega).
- **Migrazione**: `npm run db:push` aggiunge la colonna; dati esistenti invariati, `areas = []`.

Effetti dello spostamento di un corso: carte, mappe e sessioni create sul corso restano sul corso. Quelle create sul macro coprono i figli *correnti* (come oggi: `resolveScope` legge il DB a ogni richiesta).

## 2. Pagine

### `/` — Libreria (Server Component)

- Legge il DB via `lib/library.ts` (`getLibrary()`): domini, conteggio documenti, carte in scadenza aggregate (macro = somma figli), aree.
- Intestazione: titolo, pulsante **+ Aggiungi corso** (→ `/add`), filtro testuale (client) sul nome.
- Sezioni per **area**, ordine alfabetico, "Senza area" in fondo. Un elemento con più aree compare in più sezioni. Le aree si assegnano solo a **macro e corsi sciolti**: un corso figlio compare sempre e solo dentro la card del suo macro. Se un corso con aree viene spostato in un macro, le sue aree restano nel DB ma non si usano; tornano visibili se il corso ridiventa sciolto.
- **Card macro**: nome, n° corsi, carte in scadenza, elenco corsi cliccabili. Clic sul nome → studio sul macro intero.
- **Card corso sciolto**: nome, n° documenti, carte in scadenza.
- Menu "⋯" su ogni card (componente client) con le azioni della sezione 4. Pulsante **Nuovo macro**.
- Stato vuoto: "Nessun corso ancora" + pulsante verso `/add`.

### `/study/[id]?mode=tutor|quiz|review|studio` — Area studio (client)

- `id` inesistente → `notFound()`. `mode` mancante o invalido → `tutor`.
- Barra: breadcrumb **Libreria › Macro › Corso** (pezzi cliccabili) + **switcher** ▾ (albero macro → corsi per saltare altrove) + tab modalità. Cambiare tab aggiorna la query string (`router.replace`), così Indietro/ricarica/link funzionano.
- Su un macro: riga "Stai studiando tutti gli N corsi" con chip dei corsi per scendere su uno.
- Contenuto = quello attuale di `app/page.tsx`, spezzato senza cambiare comportamento:
  - `components/study/TutorView.tsx` (socratico + quiz, thread condiviso, player video, citazioni);
  - `components/study/ReviewView.tsx`;
  - `components/study/StudioView.tsx` (riassunto, mappa a tutta larghezza, slide);
  - `components/study/Markdown.tsx`, `lib/client/api.ts` (`post`, `chat`).
- Sessione socratica ripresa da localStorage come oggi (`sb_session_<domainId>`).

### `/add` — Aggiungi corso (client)

Vedi sezione 3.

### Comune

- `app/layout.tsx`: header minimo (marchio "StudyBuddy" → Libreria) e font.
- Tailwind v4 (`@tailwindcss/postcss`), token del vault in `@theme` dentro `globals.css`. Gli stili inline di `page.tsx` vengono convertiti in classi durante lo spostamento. `components/mappe/studio.css` resta com'è (scoped).

## 3. Flusso di import con anteprima

1. **Scegli cartella**: browser esistente `GET /api/fs` (sandbox `lib/fsRoot.ts`). Pulsante **Analizza** sulla cartella corrente.
2. **Analisi** — `POST /api/ingest-folder/analyze { path }`, logica pura in `lib/ingestPlan.ts` (`analyzeFolder(path)`), sola lettura, niente LLM:
   - struttura: sottocartelle con materiale ⇒ macro + un corso per sottocartella; altrimenti corso singolo; niente materiale ⇒ errore leggibile;
   - per corso: conteggi per tipo (trascrizioni, PDF, HTML, video) e video senza `.srt/.vtt`;
   - stato rispetto al DB, con lo **stesso `fileHash`** dell'ingest (`PARSER_VERSION` incluso; funzione di hash estratta ed esportata da `sources/coursera.ts`): `new` (cartella non nel DB), `upToDate`, oppure `changed` con n° file nuovi/modificati. I video non vengono hashati;
   - se una cartella è già un dominio, la proposta usa nome/macro/aree **dal DB**, non dal disco.
   - Output: `{ macro?: { path, name, existingId?, areas }, courses: [{ path, name, existingId?, parentId?, areas, counts, videosWithoutSubs, status, changedFiles }] }`.
3. **Anteprima modificabile**: macro (rinomina / aggancia a macro esistente / nessun macro), aree; per corso checkbox, nome, aree; preselezionati solo i corsi con qualcosa da fare. Opzione Whisper visibile solo se ci sono video senza sottotitoli, con avviso sui tempi.
4. **Import** — `POST /api/ingest-folder { plan, whisper }`: il server ri-valida ogni path nella sandbox e gli invarianti, applica il piano ai domini (unico punto, oltre alla Libreria, che può cambiare nome/genitore/aree di un dominio esistente), poi avvia il job in background esistente (`lib/jobs.ts`) con progresso per corso. `ingestSelection` viene rifattorizzato per eseguire un piano invece di dedurlo. Fine: **Vai alla libreria** / **Studia ora**.

Casi limite:

- un import alla volta: se c'è un job in corso, `/add` mostra quello (`GET /api/ingest-folder?active=1`) invece di avviarne un altro; il POST risponde 409 se uno è già attivo;
- job perso per riavvio del server: la UI lo segnala e invita a rilanciare (l'ingest è idempotente, riparte dai file mancanti);
- errore su un corso: segnato su quel corso, gli altri proseguono (come oggi);
- la CLI `npm run ingest` resta, con la regola di non-sovrascrittura.

## 4. Organizzazione manuale (Libreria)

API `app/api/library/route.ts` (thin wrapper su `lib/library.ts`):

- `PATCH { id, name?, areas?, parentId? }` — rinomina, aree (chip con autocompletamento dalle aree esistenti; solo macro e corsi sciolti), sposta in macro (`parentId = macroId`) / rendi sciolto (`parentId = null`);
- `POST { name, areas?, courseIds? }` — nuovo macro, opzionalmente con corsi dentro;
- `DELETE ?id=` — elimina macro (regole sezione 1), conferma esplicita in UI.

Ogni azione ri-valida gli invarianti. Dopo un'azione la Libreria si aggiorna con `router.refresh()`.

## 5. Test e verifica

Oggi il progetto non ha test. Si aggiunge `npm test` = `tsx --test` (`node:test`, nessuna dipendenza nuova), su DB SQLite temporaneo (`DB_PATH` in tmp) e cartelle-fixture create in tmp:

- `lib/library.ts`: macro dentro macro rifiutato, corso con genitore `course` rifiutato, eliminazione macro con/senza dati propri, aree e spostamenti;
- `lib/ingestPlan.ts`: macro + corsi, corso singolo, cartella vuota, video senza srt, file modificato dopo un ingest ⇒ `changed`, `PARSER_VERSION` diverso ⇒ tutto `changed`;
- non-sovrascrittura: ingest, spostamento manuale, re-ingest ⇒ `parentId`/nome/aree invariati.

Gli embedding nei test che ingeriscono passano da un provider finto (iniezione o config), per non dipendere da Ollama.

Verifica finale: `npm run typecheck`, `npm test`, `next build`, e un giro manuale nel browser (Playwright) — Libreria → Aggiungi una cartella di prova → studio su macro e su corso → sposta/assegna aree → re-import non disfa l'organizzazione.

## File toccati (indicativo)

Nuovi: `lib/library.ts`, `lib/ingestPlan.ts`, `app/study/[id]/page.tsx`, `app/add/page.tsx`, `app/api/library/route.ts`, `app/api/ingest-folder/analyze/route.ts`, `components/study/*`, `components/library/*`, `lib/client/api.ts`, test.
Modificati: `lib/db/schema.ts`, `lib/ingestTree.ts`, `lib/rag/sources/coursera.ts` (export hash), `app/api/ingest-folder/route.ts`, `app/page.tsx` (diventa la Libreria), `app/layout.tsx`, `app/globals.css`, `package.json`, `CLAUDE.md`.
