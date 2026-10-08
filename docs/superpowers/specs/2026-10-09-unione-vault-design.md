# StudyBuddy come hub personale: assorbire learning-vault — design

Data: 2026-10-09 · Stato: approccio e visione approvati in conversazione; da rivedere per iscritto

## Obiettivo

Oggi ci sono due app: **StudyBuddy v2** (questo repo, pubblico: RAG sui corsi, tutor, ripasso SM-2, mappe, slide) e **learning-vault** (repo locale senza remote: hub personale a domini, quick capture, modulo SF6). Risultato voluto:

1. **StudyBuddy è il contenitore di tutto**. learning-vault **scompare** come app: il suo codice utile e i suoi dati entrano qui.
2. StudyBuddy diventa un **hub personale**. I **corsi** ne sono la parte più grande e più importante, ma una parte; accanto ci sono altri domini (oggi SF6; in futuro chitarra e piano).
3. **Un DB solo**, **Docker + GPU** come modo normale di farla girare (Ollama resta sull'host).
4. Le **aree** di StudyBuddy **sono** i **domini** del vault.

Priorità: adesso si lavora su StudyBuddy **come app di corsi**. Del vault si porta **l'anima** (sotto), non una lista di moduli. Niente moduli per domini che non usi (TFT non si costruisce).

Decisioni prese:

- **StudyBuddy ospita il vault** (approccio A; vedi «Approcci scartati»).
- **Nome e repo invariati**: l'app resta **StudyBuddy**, repo `studybuddy-v2`.
- **Tutto il codice è pubblico, i dati restano privati**: anche shell, note e modulo SF6 entrano nel repo; i domini passano dal codice del vault (`DOMAINS`) al DB.
- Un corso può stare in **più domini** (come oggi con le aree); una nota in **uno**.

Vincoli permanenti: local-first (API cloud solo opt-in), app generica (niente codice, prompt o default pensati per un corso o un dominio specifico), `learning-vault/` e i dati mai nel repo.

## L'anima del vault

Quattro cose del vault che devono vivere in StudyBuddy:

1. **Home personale**: si apre l'app e si sa dove si è rimasti: saluto, cosa c'è oggi (carte da ripassare, corsi su cui stavi lavorando), inbox delle note.
2. **Quick capture ovunque**: un appunto al volo da qualsiasi pagina, anche mentre studi, che finisce nel posto giusto (il corso che stai studiando, il dominio che stai guardando, o l'inbox).
3. **Hub a domini**: sidebar con Corsi e i tuoi domini, stile editoriale (nero caldo + ambra, Fraunces/Geist/JetBrains Mono, già adottato). L'app sembra tua, non un tool generico.
4. **UI su misura, con un limite**: non un'app diversa per ogni dominio, ma **gli stessi pochi mattoni con contenuti diversi**. Ogni gioco e ogni strumento ha necessità sue (combo per SF6, scale per la chitarra, voicing per il piano), ma la forma è comune.

### Direzione (non in questo progetto): il repertorio

Le combo di SF6, le scale della chitarra, i voicing del piano sono tutti un **repertorio**: cose da imparare, ognuna con uno **stato di avanzamento** (`learning` → `practicing` → `consolidated`, come già le combo SF6) e una **notazione** specifica del tipo (input SF6, diteggiatura, accordo). Quando arriveranno chitarra e piano, il mattone giusto è un repertorio generico (tabella `repertoire_items` con dominio, tipo, stato, notazione, note) con renderer di notazione per tipo, non un modulo per strumento. SF6 potrà migrarci; qui si porta com'è.

Questo progetto **non** lo costruisce; fissa solo i vincoli che lo rendono possibile: domini come dati, modulo come campo del dominio, nessuna UI cablata su un dominio specifico.

## Contesto: cosa c'è oggi

| | StudyBuddy v2 | learning-vault |
|---|---|---|
| Stack | Next 16.3, React 19.3, TS 7, Tailwind v4, drizzle 0.45, better-sqlite3 13 | Next ^16.2, React 19.2, TS 5, Tailwind v4, drizzle 0.45, better-sqlite3 12 |
| Dimensione | grande; moduli nativi (sqlite-vec, onnxruntime-node su CUDA 12), sidecar Python | ~5,5k righe, di cui ~3,5k modulo SF6 |
| DB | `domains` (= corsi/macro), `documents`, `chunks`, `cards`, `sessions`, `concept_maps`, `ingested_files` + virtuali `vec_chunks` (vec0) e `chunks_fts` (FTS5) | `notes`, `settings`, `sf6_combos`, `sf6_tips`; schema creato all'avvio con `CREATE TABLE IF NOT EXISTS` |
| LLM | `generate(task)` / `embed()` in `lib/providers`, modelli per task in `config.ts` | `chat()` proprio (Ollama, o Claude via setting `use_claude`), usato in 2 punti di `sf6/import.ts` (estrazione con schema) |
| Trascrizione | sidecar locale (faster-whisper/whisper.cpp/openai-whisper) | **Groq** (cloud) + yt-dlp + ffmpeg a chunk da 24 MB |
| Avvio | `npm run dev` con `scripts/with-cuda.sh` | Docker (node:20, standalone, `network_mode: host`, niente GPU), `./data` montata |

Fatti verificati che vincolano il design:

- Esistono **due copie identiche** del vault: l'originale `~/learning-vault` e la copia in `learning-vault/` qui (stesso codice, stessi commit `439b105`, stesso DB byte per byte). Il container del vault non esiste più; il DB non è cambiato da luglio.
- I dati del vault sono **quasi tutti nel WAL** (`vault.db` 4 KB, `vault.db-wal` 222 KB): una copia del solo `.db` li perde. Aprire il DB in scrittura e chiuderlo fa il checkpoint, cioè **modifica** l'originale.
- `data/vods/` del vault è vuota.
- I `documents.source` di StudyBuddy sono **percorsi assoluti dell'host** (video, citazioni, `/api/video`).
- Il sidecar Whisper scrive solo in cartelle temporanee: i corsi si possono montare in sola lettura.
- La GPU c'è anche per Docker (runtime `nvidia`, RTX 4080 Super 16 GB).

## Approcci scartati

- **Il vault ospita StudyBuddy** (StudyBuddy nel repo del vault, DB dei corsi copiato in `vault.db`): sposta la parte difficile. `vec_chunks` e `chunks_fts` sono tabelle virtuali con rowid legati agli id dei chunk: non si copiano con `INSERT … SELECT` senza re-indicizzare (e re-embeddare). E la storia pubblica finirebbe in un repo senza remote.
- **Due app Next, un file DB**: non è «un'app» (due server, due set di dipendenze, due schemi drizzle con migrazioni concorrenti sullo stesso file).

## 1. Modello dati

Un DB solo (`DB_PATH`). Le tabelle esistenti di StudyBuddy **restano come sono**; non si rinomina `domains` (che vuol dire «corsi»): toccherebbe FK, JOIN con vec/FTS e tutto `lib/`. Il concetto «dominio» del vault prende il nome di tabella **`areas`**; «Domini» è solo l'etichetta in UI.

**Tabelle nuove**, create da `ensureHubSchema()` all'apertura del DB (idempotente, stesso schema di `ensureLibrarySchema()`, niente `db:push`) e dichiarate anche nello schema Drizzle per i tipi:

| Tabella | Colonne | Note |
|---|---|---|
| `areas` | `slug` PK, `name`, `tagline` (default `''`), `symbol` (default `'·'`), `module` (null \| nome di modulo noto), `position`, `created_at` | `slug` fisso dopo la creazione: rinominare cambia solo `name` |
| `notes` | `id`, `content`, `domain` (→ `areas.slug`, null), `course_id` (→ `domains.id`, null), `created_at` | come nel vault, più `course_id`. Nota senza `domain` né `course_id` = inbox |
| `sf6_combos`, `sf6_tips` | come nel vault, invariate | `character_slug` resta stringa (roster nel codice) |

**Colonna cambiata**: `domains.areas` resta JSON `string[]` ma contiene **slug di `areas`** invece di nomi liberi. Creare un'area dalla Libreria = creare un dominio (riga in `areas`): niente più aree «orfane».

**Conversione delle aree esistenti** (in `ensureHubSchema()`, una volta sola, in transazione): ogni nome distinto in `domains.areas` diventa una riga di `areas` con slug generato dal nome (`"Data"` → `data`), e `domains.areas` passa agli slug. Su un DB nuovo non c'è niente da convertire. Sul DB reale questo avviene la prima volta che l'app (F2 in poi) lo apre: quel primo avvio si fa **dopo un backup e il tuo ok**, come per `ensureLibrarySchema()`.

**Aggancio ai domini del vault** (script di import, sezione 5): un dominio del vault con lo stesso slug di un'area già convertita è **lo stesso dominio**: l'area prende simbolo, tagline e modulo dal vault e tiene il nome che ha. Gli altri domini del vault si aggiungono, tranne quelli esclusi.

**Invarianti** (in `lib/areas.ts`, errore 400 leggibile):

- non si elimina un dominio con note o con corsi assegnati (il messaggio dice quanti);
- `slug` unico, `[a-z0-9-]+`, generato dal nome alla creazione;
- `module` accetta solo i moduli registrati nel codice (oggi solo `sf6`, vedi sezione 2);
- una nota ha al più uno tra `domain` e `course_id` (una nota su un corso appare nei domini del corso).

Fuori di proposito: una tabella `settings` (nessuna impostazione da UI la richiede ancora), FK dichiarate su `notes` (la validazione sta in `lib/`; la cancellazione di un corso è già fuori scope), progressi o sessioni per dominio, il repertorio (vedi «Direzione»).

## 2. Navigazione e pagine

**Shell**: la sidebar del vault su tutte le pagine, al posto della barra in alto. Sotto `md` diventa un drawer (pulsante ☰). Su `/study/*` parte **compressa a icone**, espandibile a mano.

```
StudyBuddy                    → /
           ⌂ Home
           ▤ Corsi   (3)      → /corsi; badge = carte in scadenza su tutti i corsi
DOMINI     ✦ …                → /d/[slug], dalla tabella areas, ordine per position
           ◐ Impostazioni
           ✎ Appunto  (n)     → quick capture
```

**Route**:

| Route | Contenuto | Origine |
|---|---|---|
| `/` | **home personale**: saluto contestuale; **Oggi** = carte in scadenza per corso (→ `/study/[id]?mode=review`) e ultimi corsi studiati (da `sessions`, → ripresa); **inbox** delle note. Ogni blocco compare solo se ha contenuto | vault, esteso |
| `/corsi` | Libreria attuale: card raggruppate per **dominio** (nome + simbolo), «Senza dominio» in fondo, banner, filtro | da `/` |
| `/corsi/add` | wizard di import attuale | da `/add` |
| `/study/[id]` | invariata, più le note del corso (pannello leggero, dalla quick capture) | — |
| `/d/[slug]` | pagina dominio: intestazione (simbolo, nome, tagline); **Corsi** del dominio (stesse card della Libreria); link al **modulo** se c'è; **note** del dominio e dei suoi corsi | vault `/[domain]`, esteso |
| `/sf6/**` | modulo SF6 com'è | vault |
| `/settings` | **gestione domini** (crea, rinomina, simbolo, tagline, modulo, ordine, elimina) + stato (Ollama, reranker GPU/CPU) | vault, ridotta |

Nessuna pagina «dominio non ancora costruito»: un dominio senza corsi, note né modulo mostra solo la quick capture.

`/[domain]` alla radice diventa `/d/[slug]`: così nessun dominio può coprire una pagina (`corsi`, `settings`…) e non serve una lista di nomi riservati.

**Quick capture ovunque**: componente nella shell (voce in sidebar + scorciatoia `n` fuori dai campi di testo) che apre un piccolo pannello. Il contesto decide dove va la nota: su `/study/[id]` → `course_id`; su `/d/[slug]` e `/sf6/**` → `domain`; altrove → inbox. Si può cambiare destinazione prima di salvare, e spostare una nota dall'inbox dopo.

**Moduli**: un registro nel codice (`lib/modules.ts`: nome → titolo, route) dice quali moduli esistono. Un dominio con `module` mostra il link al modulo; il modulo non dipende dallo slug del dominio.

**API**: quelle del vault (`/api/notes`, `/api/sf6/*`) si aggiungono come thin wrapper su `src/lib/*`; nuova `/api/areas`; `/api/health` per lo stato. Passano tutte da `src/proxy.ts`. Eccezione esplicita e unica al vincolo JSON per l'upload dei VOD (`/api/sf6/upload`, `multipart/form-data`): resta il controllo sull'host locale, più un controllo `Origin` uguale all'host (un form cross-site non può impostare un `Origin` locale).

**Stile**: StudyBuddy usa già palette e font del vault; il `globals.css` del vault diventa la base comune. Gli stili inline delle viste di studio restano come sono.

## 3. LLM e trascrizione

**Un solo layer LLM**: il `chat()` del vault sparisce. Le due chiamate di `sf6/import.ts` passano a `generate("extract", { schema, … })` con un task nuovo `extract` in `config.models` (default Ollama, stesso modello di `chat`; `numCtx` per chiamata come oggi nel vault). Le impostazioni del vault `ollama_model` e `use_claude` non si portano: i modelli restano in `config.ts` come per il resto di StudyBuddy.

**Trascrizione**: `lib/transcribe.ts` prende anche file audio (non solo video) e ha due backend:

- `local` (default): il sidecar Whisper attuale, su GPU nel container;
- `groq` (opt-in): il client Groq del vault, con il chunking ffmpeg a 24 MB, attivo solo se c'è `GROQ_API_KEY` in `.env`.

La pipeline SF6 (yt-dlp → audio → trascrizione → estrazione) usa `transcribe` invece di chiamare Groq direttamente.

## 4. Docker + GPU

**Immagine** (un `Dockerfile`, multi-stage, build e runtime sulla **stessa base** per non mescolare ABI dei moduli nativi):

- base `nvidia/cuda` **12.x runtime con cuDNN** (onnxruntime-node è compilato per CUDA 12 e il provider CUDA vuole cuDNN; ctranslate2 di faster-whisper pure) + **Node 24**; versioni esatte fissate nel piano;
- Python venv con `faster-whisper` e `yt-dlp`; `ffmpeg` da apt;
- `output: "standalone"`, con i pacchetti nativi di `serverExternalPackages` (better-sqlite3, sqlite-vec, onnxruntime-node, @huggingface/transformers) presenti nell'immagine finale (da verificare nel piano: il tracing di standalone non sempre li copia tutti);
- utente `1000:1000`. Nel container le lib CUDA 12 sono di sistema: `scripts/with-cuda.sh` serve solo fuori da Docker.

**Compose** (`docker-compose.yml`):

- `network_mode: host` (Ollama sull'host a `127.0.0.1:11434`; `src/proxy.ts` accetta solo host locali);
- GPU con `deploy.resources.reservations.devices` (`driver: nvidia`, `capabilities: [gpu]`); un override `compose.cpu.yaml` la toglie per chi non ha GPU (reranker e Whisper hanno già il fallback CPU);
- volumi:
  - `./data:/app/data`: DB (`/app/data/studybuddy.db`), cache dei modelli (`/app/data/models`, oggi `.models/`: `config.reranker.cacheDir` diventa sovrascrivibile da env), VOD (`/app/data/vods`), backup;
  - **cartella corsi montata allo stesso percorso assoluto dell'host**, in sola lettura (`${COURSES_DIR}:${COURSES_DIR}:ro`). Così i `documents.source` già nel DB restano validi, senza riscrivere percorsi;
- env: `DB_PATH`, `STUDYBUDDY_LIBRARY_DIR=${COURSES_DIR}`, `STUDYBUDDY_FS_ROOT=${COURSES_DIR}` (nel container non c'è altro da sfogliare), chiavi opzionali da `.env`.

`.gitignore`: si aggiunge `data/` alla radice (attenzione a non confonderla con il vecchio backup `studybuddy.db` nella radice del repo: è un altro file). `npm run dev` fuori da Docker resta supportato per lo sviluppo.

## 5. Migrazione dei dati e passaggio

Principio: **gli originali non si toccano mai**. Il DB unito è un file nuovo, `data/studybuddy.db`; `studybuddy-v2.db` e `~/learning-vault/data/` restano come backup finché decidi tu.

**Script** `scripts/import-vault.ts --vault <cartella del vault> --target <data/studybuddy.db> [--skip <slug>…] [--apply]`:

1. crea il target con il backup online di SQLite da `studybuddy-v2.db` (`.backup`: copia coerente anche col WAL). Rifiuta se il target esiste già;
2. copia **insieme** `vault.db`, `vault.db-wal`, `vault.db-shm` in una cartella temporanea e apre **la copia** (mai l'originale: aprirlo farebbe il checkpoint);
3. legge i domini dal codice del vault stesso (`import()` dinamico di `<vault>/src/lib/domains.ts`): la lista non entra mai nel repo. Un dominio il cui slug coincide con un modulo registrato prende quel `module`. `--skip` esclude domini (es. uno che non userai): se hanno note, le note finiscono nell'inbox, e il dry-run lo dice;
4. **dry-run** (default): stampa ogni dominio del vault con i suoi conteggi (note, combo e tip), cosa succede (agganciato / nuovo / escluso), le impostazioni portate o scartate, la mappa aree StudyBuddy → domini;
5. con `--apply`: `ensureHubSchema()` sul target (converte le aree se non è già stato fatto), poi in **una transazione** `areas`, `notes` (id e date originali), `sf6_*`. La tabella `settings` del vault non si porta (nessuna chiave serve più: `groq_api_key`, se presente, viene segnalata come da spostare in `.env`, non copiata). Alla fine ricontrolla i conteggi e li stampa.

**Passaggio**: dopo l'apply, `docker compose up` sul nuovo DB; verifica a mano (home e note, SF6, un corso con chat e video al minuto, ripasso). Il vecchio container del vault non esiste già; `~/learning-vault` resta come archivio.

Ogni passo che tocca `studybuddy-v2.db` o i dati del vault (anche solo in lettura) si fa **dopo il tuo ok esplicito**.

## 6. Fasi

Un branch e un piano per fase, nell'ordine; ognuna lascia l'app funzionante. Prima ciò che serve ai corsi e porta l'anima del vault, poi SF6.

| Fase | Contenuto | Verifica |
|---|---|---|
| **F1 Docker + GPU** | Dockerfile, compose (+ override CPU), `data/`, `/api/health`; nessun codice del vault | nel container: reranker su `cuda`, Whisper su GPU, ingest + chat + video su un DB e una cartella corsi temporanei |
| **F2 Domini** | `areas`, `ensureHubSchema()`, `lib/areas.ts`, `domains.areas` → slug, Libreria raggruppata per dominio, gestione domini in Impostazioni | test `node:test` su invarianti, conversione aree, idempotenza dello schema |
| **F3 Hub: shell, home, quick capture** | sidebar, home personale, `/corsi`, `/corsi/add`, `/d/[slug]`, quick capture con contesto, note sul corso in `/study`, `/api/notes`, `/api/areas`, registro moduli | test su `lib/` (note e destinazioni, «Oggi» aggregato); Playwright su DB temporaneo |
| **F4 Import e passaggio** | `scripts/import-vault.ts` (note, domini, tabelle SF6 già popolate), README (EN) e CLAUDE.md aggiornati | test con un vault finto **con dati solo nel WAL**; poi, col tuo ok, dry-run e apply sui dati reali |
| **F5 Modulo SF6** | port di `sf6/**` com'è (TS 7, `generate("extract")`, `transcribe` locale/Groq), eccezione multipart in `proxy.ts` | test proxy (multipart solo su quella route, `Origin` controllato) e backend di trascrizione; Playwright sulle pagine SF6 |

Dopo F4 learning-vault non serve più per le note; dopo F5 non serve più per niente. La storia git del vault (2 commit) non si importa: il codice entra con commit che citano l'origine (`learning-vault@439b105`).

## Fuori scope

- Il repertorio generico e i domini chitarra/piano (vedi «Direzione»).
- Moduli per domini che non usi (TFT).
- Impostazioni dei modelli da UI (restano in `config.ts`).
- Chat AI laterale per dominio, sessioni di pratica con timer, dashboard tra domini (idee del README del vault: possibili dopo, nulla le impedisce).
- Restyling delle viste di studio (stili inline).
- Autenticazione, multi-utente, accesso da LAN (resta `STUDYBUDDY_ALLOWED_HOSTS`).
- Eliminare un corso dal DB.
- Nuovi screenshot (dopo F4, con sfocatura come oggi).
- Cancellare `~/learning-vault`, `learning-vault/` o `studybuddy-v2.db`: lo decidi tu.
