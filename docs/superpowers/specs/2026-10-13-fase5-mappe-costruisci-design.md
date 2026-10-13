# Fase 5 — Mappe in modalità «costruisci tu» (design)

2026-10-13 · riferimento: `StudyBuddy v2 — Piano di lavoro.md`, Fase 5.

## Obiettivo

Accanto alla mappa generata nasce un esercizio: il modello genera la mappa come oggi, ma lo studente vede solo i concetti (con la definizione) e una domanda focale. Le relazioni le traccia lui, un valutatore le giudica, e solo alla fine compare la versione del modello. Principio del piano: **prima provi, poi vedi**.

**Fatto quando:** sul set `maps.jsonl` il verdetto del valutatore coincide con quello di riferimento in almeno l'80% delle proposizioni.

## Scelte dell'utente

- Le relazioni si tracciano da un **pannello dedicato** accanto alla tela («Le tue proposizioni»: [concetto ▾] [verbo] [concetto ▾] Aggiungi), non dal form dell'inspector né trascinando sulla tela.
- Durante l'esercizio la scheda di un concetto mostra **solo la definizione**; spiegazione ed esempi tornano con «Completa la mappa».
- «Mostra soluzione» apre una **vista in sola lettura** (i tuoi archi pieni, quelli in più della soluzione tratteggiati, «Torna alla tua mappa»); il pulsante **«Completa la mappa»** aggiunge gli archi mancanti e le spiegazioni, e il livello torna una mappa normale.
- Una soluzione **per livello** (approccio A): radice + ogni bolla in cui si entra.
- La revisione dei verdetti di `maps.jsonl` la fa Claude sui passaggi sorgente (chi studia non può giudicare relazioni su materia che deve ancora imparare). Il set si costruisce dal DB reale **in sola lettura**.

## Verifica preliminare (punto aperto del piano)

L'editor permette già di tracciare a mano una relazione con etichetta (`editor.js`, form «Collega a… / Crea relazione →»), espone `applyCommands()`, `getStatus()`, `subscribe()` e la modalità `readOnly`, e gli approfondimenti passano dall'adattatore `expandConcept` dell'host. **Il motore PolyForm (`src/components/mappe/*.js`, `src/lib/mappe/*.js`) non si modifica.** Il codice nuovo sta in file TypeScript sotto MIT, che usano il motore tramite i comandi atomici e le funzioni pure esportate (`mapFromProposal`, `createRelation`, `titleKey`, `applyMapCommands`).

## 1. Dati

Tabella `map_exercises` (in `schema.ts`, `schemaSql.ts` rigenerato con `npm run db:schema`, creata sui DB esistenti da `ensureHubSchema()` con `ensureTable`):

| colonna | tipo | note |
|---|---|---|
| `id` | integer PK autoincrement | |
| `map_id` | text NOT NULL | → `concept_maps.id` |
| `level_key` | text NOT NULL | `root` oppure l'id del concetto proprietario della tela |
| `focus_question` | text NOT NULL | |
| `proposal` | text JSON NOT NULL | proposta completa: concetti (titolo, definizione, spiegazione, esempi, `sourceRefs`) e relazioni `{from, to, label}` per titolo |
| `last_check` | text JSON | esito dell'ultima verifica |
| `created_at`, `checked_at`, `revealed_at`, `completed_at` | integer (secondi) | |

`UNIQUE(map_id, level_key)`. `deleteMap` cancella le righe della mappa nella stessa transazione (nessuna dipendenza da `PRAGMA foreign_keys`).

**Soluzione per titolo.** Gli id dei concetti di un approfondimento li crea il browser (`expansionCommands`), quindi la soluzione resta per titolo e si risolve negli id con `titleKey` al momento della verifica, fra i concetti che hanno una bolla nella tela. Rinominare una bolla durante l'esercizio fa perdere le sue coppie: il pannello lo dice in una riga.

La soluzione non arriva mai al browser prima di «Mostra soluzione»: nessuna API restituisce `proposal` per intero prima di `revealed_at`.

## 2. Generazione

`conceptmap.ts`:
- `propose()` accetta `{ build: true }`: lo schema ha in più `focus_question` (ultima proprietà, così la domanda arriva dopo i concetti) e il prompt di sistema una frase in più («`focus_question`: una domanda a cui questa mappa risponde, formulata per chi studia»). **Il prompt della modalità normale resta identico.**
- `generateMap(domainId, topic, sourceChunks?, opts?)` e `expandConcept(..., opts?)` passano `build` e, in modalità build, restituiscono anche `focusQuestion`. Le chiamate esistenti non cambiano.

`src/lib/mapExercise.ts` (server, MIT):
- `createExercise(domainId, topic, sourceChunks?)`: genera in modalità build, costruisce il documento-esercizio, salva mappa (`saveMap`) e riga `root` in una transazione, restituisce `{ map }`.
- `expandExercise(mapId, domainId, conceptId, request)`: genera il sottolivello in modalità build, salva o **fonde** la riga `level_key = conceptId` (un secondo «✦ Espandi dal materiale» accoda concetti e relazioni) e restituisce al browser la proposta **spogliata**: concetti con la sola definizione, `relations: []`. Il motore la applica come oggi.
- `exerciseLevels(mapId)`: righe senza `proposal` (`levelKey`, `focusQuestion`, `lastCheck`, `checkedAt`, `revealedAt`, `completedAt`).

`src/lib/mapExerciseCore.ts` (puro, gira anche nel browser):
- `exerciseDocument(title, proposal, seed)`: `mapFromProposal` con concetti spogliati e nessuna relazione, poi tutte le bolle della stessa misura (220×110) in una griglia da 4 colonne in ordine rimescolato (deterministico dal seed), centro compreso: la disposizione radiale e la bolla grande tradirebbero l'hub.
- `stripProposal(proposal)`: concetti con titolo, tipo, definizione e `sourceRefs`; spiegazione ed esempi vuoti; nessuna relazione.

Nei sottolivelli `expansionCommands` mette il concetto proprietario al centro e i nuovi in cerchio: non rivela nulla oltre a ciò che il livello dichiara (sono tutti aspetti di quel concetto).

## 3. Verifica

`evaluateLevel(mapId, spaceId)` in `mapExercise.ts`. Legge il documento **salvato** (il client salva prima di verificare) e la riga del livello (`root` se `spaceId` è la tela iniziale, altrimenti l'`ownerConceptId` della tela). Le proposizioni sono le relazioni del documento fra due concetti che hanno una bolla in quella tela.

1. **Confronto in codice** (`comparePairs` in core): coppie non ordinate; risolve i titoli della soluzione negli id dei concetti della tela (quelli non risolvibili si ignorano). Esito: coppie in comune, solo dello studente, mancanti. Le mancanti si mostrano come coppie di **nomi**, senza etichetta.
2. **Una chiamata LLM**, `judgePropositions({ focusQuestion, propositions, passages })` (esportata da sola per l'eval). Task `grade`, temperatura 0. Massimo **15** proposizioni: oltre, la funzione lancia e la UI blocca «Verifica» prima. Contesto:
   - la domanda focale;
   - i passaggi sorgente dei concetti della tela, presi dai `sourceRefs` della proposta (chunk letti dal DB, deduplicati, ≤ 1500 caratteri l'uno, tetto totale 10 000 caratteri), numerati [n];
   - le proposizioni numerate `P1: «A» — verbo → «B»`, e per quelle la cui coppia è nella soluzione la riga «formulazione di riferimento (una possibile, non l'unica): A label B».

   Schema: `{ items: [{ id, reason, verdict: "valid"|"imprecise"|"wrong", fix }] }`, `reason` prima del verdetto. Regole del prompt: una relazione giustificata dal materiale è `valid` anche se manca dalla soluzione o usa altre parole; `imprecise` = il legame c'è ma il verbo è vago o sbagliato, oppure la direzione è invertita; `wrong` = il materiale non sostiene il legame o lo contraddice; `fix` = una frase che corregge, vuota se `valid`. Lingua del feedback: italiano.

   JSON non valido o senza `items`: un retry, poi **errore** (nessun verdetto inventato). Una proposizione senza voce nella risposta resta `unrated` («non valutata») e non conta come sbagliata. `PROMPT_VERSION = "maps-v1"`.
3. **Esito** `{ verdicts: [{ relationId, sourceId, targetId, label, verdict, reason, fix, inSolution }], missing: [{ a, b }], checkedAt }`, salvato in `last_check` + `checked_at`. Si può correggere e verificare di nuovo quante volte si vuole.

## 4. Soluzione, completamento, carte

- `revealLevel(mapId, spaceId)` imposta `revealed_at` e restituisce le relazioni della soluzione per titolo. `overlayDocument(doc, spaceId, solution)` (core) clona il documento e aggiunge le coppie mancanti come relazioni **non direzionali** (la tela le disegna tratteggiate): la vista si monta con `readOnly` in un secondo contenitore e non si salva mai.
- `completeLevel(mapId, spaceId)` imposta `completed_at` e restituisce soluzione e concetti completi; `completionCommands(doc, spaceId, solution)` (core) produce `addRelation` per le coppie mancanti (provenienza `llm`) e `updateConcept` che rimette spiegazione ed esempi ai concetti della tela che li hanno vuoti. Il client li applica con `editor.applyCommands` e l'autosalvataggio fa il resto. Un livello completato non mostra più il pannello dell'esercizio.
- **Crea carta** (solo sulle proposizioni `wrong`): `relationCardDraft(mapId, spaceId, relationId)` restituisce `{ question: "Che relazione c'è tra «X» e «Y»?", answer, sourceChunkId }`. `answer` = «X label Y» dalla soluzione se la coppia c'è, altrimenti il `fix` della verifica. `sourceChunkId` = primo `sourceRef` dei due concetti. Il client mostra la bozza modificabile con `checkCard` ricontrollato mentre scrivi (stesso comportamento di `CardPreview`): «Salva» è disabilitato finché ci sono segnalazioni. Poi `POST /api/cards { domainId, cards: [...] }` (`saveCards`, dedup nello scope del macro).

## 5. API (thin wrapper in `src/app/api/maps/exercise/`)

| route | corpo | funzione |
|---|---|---|
| `GET /api/maps/exercise?mapId=` | | `exerciseLevels` |
| `POST /api/maps/exercise` | `{ domainId, topic }` | `createExercise` |
| `POST /api/maps/exercise/expand` | `{ mapId, domainId, conceptId, concept, path, existing, present }` | `expandExercise` |
| `POST /api/maps/exercise/check` | `{ mapId, spaceId }` | `evaluateLevel` |
| `POST /api/maps/exercise/reveal` | `{ mapId, spaceId }` | `revealLevel` |
| `POST /api/maps/exercise/complete` | `{ mapId, spaceId }` | `completeLevel` |
| `POST /api/maps/exercise/card` | `{ mapId, spaceId, relationId }` | `relationCardDraft` |

`runtime = "nodejs"`, errori di dominio → 400/404/409 con `{ error }`, errori del modello → 500. `listMaps` aggiunge `exercise: boolean` (EXISTS sulla tabella) per il marcatore nell'elenco.

## 6. UI

- **MapStudio** (`components/mappe/MapStudio.tsx`, già file dell'app): casella «Costruisci tu» accanto a «Genera mappa». Se spuntata, la generazione chiama `POST /api/maps/exercise`. Nell'elenco le mappe-esercizio hanno il prefisso «✎ ». Per una mappa-esercizio carica i livelli, avvolge l'adattatore `expandConcept` verso `/api/maps/exercise/expand` e affianca alla tela il pannello (sotto la tela sotto `md`).
- **MapExercise** (`components/study/MapExercise.tsx`, nuovo): segue il livello corrente da `editor.getStatus().ui.spaceId` e il documento via `subscribe`.
  - Domanda focale del livello; se il livello non ha una riga: «Nessun esercizio su questo livello».
  - Form [da ▾] [verbo] [a ▾] «Aggiungi», con i soli concetti della tela → `applyCommands([{ type: "addRelation", relation: createRelation(...) }])`.
  - Elenco delle proposizioni della tela: «A → verbo → B», verdetto con **icona e testo** (✓ Valida · ≈ Imprecisa · ✗ Sbagliata · – Non valutata; colori dai token `--success`/`--warning`/`--danger`, niente colori nuovi), motivo, correzione, «Rimuovi», e su `wrong` «Crea carta». Il verdetto si mostra solo se la relazione è uguale a quella verificata (stessi estremi ed etichetta).
  - Contatore «n/15», «Verifica» disabilitato con 0 o più di 15 proposizioni; prima salva l'editor se ci sono modifiche.
  - Dopo una verifica: «Coppie mancanti (k)» con i soli nomi, e «Mostra soluzione» attivo.
  - In vista soluzione: legenda («tratteggiati = archi della soluzione che non hai tracciato»), «Torna alla tua mappa», «Completa la mappa».
  - Stili: utility Tailwind dei token (`bg-surface`, `text-fg-dim`…) o `var(--semantico)`, come il resto dell'app; nessun hex.

## 7. Eval `maps.jsonl`

Logica pura in `src/lib/evals/maps.ts`, comando in `scripts/eval.ts`, dati e risultati in `evals/data|results/` (gitignored), formato in `evals/README.md`.

- `npm run eval -- maps --build <db> [--force]`: apre il DB **in sola lettura**, sceglie 6 argomenti da 3 corsi (2 per corso, dai nomi dei moduli), genera le soluzioni in modalità build e scrive `evals/data/maps.draft.jsonl` con `{ id, course, topic, focusQuestion, concepts: [{title, definition}], solution: [{from, label, to}], passages: [{n, chunkId, text}] }`.
- Claude scrive `maps.jsonl` aggiungendo a ogni caso `propositions: [{ id, from, label, to, gold, kind }]`, circa 10 per caso (~60 in tutto). `kind` ∈ `same` (come la soluzione), `absent-valid` (giusta ma assente dalla soluzione), `vague` (verbo vago), `inverted` (direzione invertita), `wrong` (sbagliata plausibile). `gold` deciso sui passaggi.
- `npm run eval -- maps [--limit N]`: per ogni caso chiama `judgePropositions` e confronta con `gold`. Metriche: accordo esatto (obiettivo ≥ 80%), matrice di confusione, accordo per `kind`, e a parte le **`absent-valid` bocciate** (`wrong`), l'errore più dannoso per chi studia. Risultati in `evals/results/maps-<data>.json`.

## 8. Test

- `tests/mapExerciseCore.test.ts`: `exerciseDocument` (nessuna relazione, solo definizione, bolle uguali senza sovrapposizioni, deterministico, documento valido), `stripProposal`, `comparePairs` (direzione ignorata, titoli irrisolvibili ignorati, comuni/extra/mancanti), `overlayDocument` (solo le mancanti, non direzionali, documento valido), `completionCommands` (si applica con `applyMapCommands`, rimette spiegazioni ed esempi solo dove vuoti).
- `tests/mapExercise.test.ts` (DB temporaneo + Ollama finto `withJudge`): `createExercise` con `sourceChunks` salva mappa spogliata e riga `root`; `expandExercise` salva e poi fonde; `judgePropositions` (retry poi errore, > 15 lancia, voci mancanti `unrated`, `fix` svuotato sui `valid`); `evaluateLevel` salva `last_check`; `revealLevel`/`completeLevel` impostano le date; `relationCardDraft` (soluzione o `fix`); `deleteMap` cancella le righe; `listMaps` segnala gli esercizi.
- `tests/hubSchemaMapExercises.test.ts`: `ensureHubSchema()` crea la tabella su un DB esistente; `schemaSql.test.ts` copre la rigenerazione.
- `tests/eval-maps.test.ts`: parsing di `maps.jsonl` e metriche.
- Verifica dal vivo con Playwright su DB e cartella-libreria **temporanei** (mini-corso sintetico) e Ollama vero: crea esercizio, aggiungi proposizioni, verifica, coppie mancanti, soluzione, completa, crea carta, entra in una bolla.
- `npm run typecheck`, `npm test`; `npm run build` solo con `DB_PATH` temporaneo.

## Fuori ambito

- Trascinare gli archi sulla tela (richiederebbe di modificare `tela.js`).
- Bloccare la rinomina dei concetti durante l'esercizio.
- Statistiche o storico dei tentativi oltre all'ultima verifica.
- Generazione di carte dalle proposizioni `imprecise`.
