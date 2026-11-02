# Set di valutazione

Casi fissi da rigirare a ogni modifica di un prompt (Fase 0 del piano di lavoro).
Usano il modello vero configurato in `src/lib/config.ts`, quindi stanno fuori da `npm test`.

```bash
npm run eval -- grading                    # tutti i casi
npm run eval -- grading --only-confirmed   # solo i verdetti già rivisti
npm run eval -- grading --limit 5          # prova veloce
```

`evals/data/` e `evals/results/` sono gitignored: contengono estratti di corsi a pagamento.
Ogni esecuzione salva `results/<data>-<modulo>-<PROMPT_VERSION>.json` (metriche e output
caso per caso), così due versioni di un prompt si confrontano affiancate.

## grading.jsonl

Una riga JSON per caso (righe vuote e `//` ignorate):

| Campo | |
|---|---|
| `id` | univoco, es. `long-wrong-3` |
| `question`, `expected` | domanda e risposta attesa della carta |
| `answer` | la risposta dello studente da valutare |
| `verdict` | `wrong` · `partial` · `correct`: **il tuo** verdetto, la verità del set |
| `tags` | `perfect`, `synonym`, `it-en`, `partial`, `long-wrong`, `wrong`, `empty` |
| `source` | passaggio sorgente della carta (lo usa il giudice dalla Fase 2) |
| `cardId` | carta da cui viene il caso |
| `confirmed` | `true` dopo la revisione; finché è `false` il verdetto è solo una proposta |

Criterio dei verdetti (quello con cui sono stati confermati i casi; il prompt del giudice della Fase 2 deve seguirlo):
**si valuta ciò che la domanda richiede**, non tutto ciò che la risposta attesa contiene.
- **correct**: risponde a ciò che è chiesto, anche con parole diverse o in un'altra lingua. Un dettaglio secondario omesso non impedisce correct (es. un "perché" non richiede anche il "come mitigare").
- **partial**: manca, o è sbagliato, un elemento che la domanda richiede (anche un'aggiunta falsa attribuita a ciò che è chiesto). Negli elenchi e negli abbinamenti, una parte corretta vale partial: niente tutto-o-niente.
- **wrong**: sbaglia la proprietà centrale (es. "rileva dopo" al posto di "blocca prima", un flag che non fa ciò che distingue il comando), oppure è vuota / "non so".
- Se la risposta attesa della carta è imprecisa, conta la realtà (e la carta va corretta).

Metriche: accordo esatto, accordo entro 1 (wrong < partial < correct), matrice di confusione
e numero di casi `long-wrong` promossi a `correct` (obiettivo della Fase 2: 0, con accordo esatto ≥ 80%).
Dalla Fase 2 il giudice (`grade-v2`) dà direttamente il verdetto, dopo aver elencato cosa chiede la domanda (`required`), cosa c'è (`present`), cosa manca (`missing`) e cosa è falso (`errors`); riceve il `source` del caso. `grade-v1` (voto 0–5) era convertito con 0–2 → wrong, 3 → partial, 4–5 → correct.

## cards.jsonl (Fase 3)

Passaggi di trascrizione da cui il generatore (`tutor/cardGen.ts`, `cards-v1`) crea carte.

```bash
npm run eval -- cards --build <db>        # 10 passaggi lunghi da ciascuno dei 3 corsi con più trascrizioni (DB aperto in sola lettura)
npm run eval -- cards                     # genera e misura; --limit N per una prova veloce
npm run eval -- cards-review <file>       # conta le carte tenute nella revisione manuale
```

| Campo | |
|---|---|
| `id` | univoco, es. `c3-7` |
| `course` | nome del corso (per le metriche per corso) |
| `content` | testo del chunk (le trascrizioni vengono ripulite da `cleanTranscript` prima di generare) |
| `docKind` | default `transcript` |
| `chunkId` | chunk di origine |

Metriche: quota di carte che passano `checkCard` (obiettivo ≥ 85%), problemi per tipo, passaggi senza carte.
Ogni run scrive anche `results/<data>-cards-<versione>-review.jsonl`: 20 carte valide distribuite sul set con `"keep": null`;
metti `true` (da tenere senza modifiche) o `false` (con una `note`) e lancia `cards-review` (obiettivo ≥ 17/20).

Criterio della revisione: si tiene così com'è una carta **corretta rispetto al passaggio** (verificata sul testo),
che **si capisce senza aver visto il video** (nomina lo strumento, il linguaggio, la proprietà), che riguarda
**la materia** e non il corso (niente logistica, statistiche motivazionali, slogan, storie d'esempio),
con una risposta precisa e un italiano corretto, e che **non serve riscrivere**.

## tutor.jsonl (Fase 4)

Richieste di soluzione su esercizi presi dai corsi, più domande di spiegazione a cui il tutor deve continuare a rispondere.

```
npm run eval -- tutor --build <db> [--force]   # bozza tutor.draft.jsonl: un passaggio per riga, message vuoto
npm run eval -- tutor [--limit N]              # prompt corrente (PROMPT_VERSION in session.ts)
npm run eval -- tutor --baseline               # prompt di prima della Fase 4 (tutor-v0), senza controllo dei turni
npm run eval -- tutor-review <file -review.jsonl>
```

La bozza ha 30 passaggi da 3 corsi (sola lettura del DB): `message` va scritto a mano (la richiesta di soluzione o la domanda
di spiegazione) e `kind` corretto, poi si salva come `tutor.jsonl`. Una riga per caso:

| Campo | Contenuto |
|---|---|
| `id` | identificativo unico |
| `course` | nome del corso |
| `kind` | `exercise` (richiesta di soluzione) o `explanation` (domanda di spiegazione) |
| `context` | passaggio del corso, passato al tutor come `[1]` |
| `history` | turni precedenti `{role, content}` (default vuoto) |
| `message` | messaggio dello studente |
| `level` | livello di indizio del turno, 1–4 (default 1) |
| `chunkId` | chunk di origine |

Metriche automatiche: turni a rischio, quanti intercettati (almeno una risposta bloccata dal controllo), indizi fissi, tempo medio dei
turni a rischio contro gli altri; `--baseline` produce lo stesso rapporto col prompt `tutor-v0` per il confronto.
Ogni run scrive `results/<data>-tutor-<versione>-review.jsonl` con `"leak": null` sugli esercizi e `"explains": null` sulle spiegazioni.

Obiettivi: **meno del 10%** di esercizi con la soluzione data, tempo medio dei turni a rischio < baseline + 4 s, **tutte** le spiegazioni date.

Criterio della revisione: `leak: true` se la risposta contiene la risposta finale, il codice che risolve l'esercizio, o tutti i passi in modo
che basti copiarli; un esempio su un caso diverso, il concetto o il solo passo successivo non sono una perdita. `explains: true` se risponde
alla domanda di spiegazione invece di rimandare con altre domande.

## Mappe (`maps`, Fase 5)

```
DB_PATH=<file temporaneo> npm run eval -- maps --build data/studybuddy.db   # bozza evals/data/maps.draft.jsonl (--force per sostituirla)
# scrivi le proposizioni e salva come evals/data/maps.jsonl
DB_PATH=<file temporaneo> npm run eval -- maps [--limit N]
```

`DB_PATH` temporaneo perché lo script importa `@/lib/db`, che all'apertura esegue le migrazioni: senza, toccherebbe il DB reale.
Il DB indicato con `--build` si apre comunque in sola lettura.

La bozza ha 6 mappe in modalità build (2 moduli per ciascuno dei 3 corsi con più materiale) con `propositions: []`. Una riga per caso:

| Campo | Contenuto |
|---|---|
| `id` | identificativo unico |
| `course`, `topic` | corso e argomento (modulo) |
| `focusQuestion` | domanda-guida della mappa |
| `concepts` | `{title, definition}` dei concetti |
| `solution` | relazioni della soluzione `{from, label, to}` |
| `passages` | passaggi `{n, chunkId, text}` che il valutatore vede |
| `propositions` | `{id, from, label, to, gold, kind}`: `gold` = `valid` · `imprecise` · `wrong` |

I cinque `kind` delle proposizioni: `same` (la coppia della soluzione, riformulata), `absent-valid` (coppia fuori dalla soluzione ma sostenuta dal
materiale), `vague` (verbo generico), `inverted` (direzione invertita), `wrong` (non sostenuta o contraddetta).

Criterio dei verdetti (le regole di `JUDGE_SYSTEM`): `valid` se il materiale sostiene il legame anche fuori dalla soluzione; `imprecise` se il verbo
è vago o sbagliato o la direzione è invertita; `wrong` se il legame non è sostenuto o è contraddetto.

Obiettivo: **accordo esatto ≥ 80%** col verdetto di riferimento. Metrica di controllo: `absent-valid bocciate X/Y`, cioè le proposizioni valide ma
assenti dalla soluzione giudicate `wrong` (il valutatore non deve penalizzare chi trova un legame buono diverso da quello della soluzione).
Ogni run scrive `results/maps-<ISO>.json` con `promptVersion`, `model`, `metrics` e le righe.

## Lezioni: Cornell e pretesting (Fasi 7.2–7.3)

Il set **sintetico e committabile** `fixtures/lessons.json` contiene sei lezioni di materie diverse,
senza estratti dei corsi. La generazione usa `cornell-v1` (`lessonPrompts.ts`) e il prompt esistente
`quiz-v1` (`tutor/quiz.ts`, invariato). Il pretesting non chiama un giudice e non crea carte o review.

```bash
DB_PATH=/tmp/studybuddy-eval-lessons.db npm run eval -- lessons
# Riusa le domande guida della run appena prodotta per verificare i sei riassunti di riferimento:
DB_PATH=/tmp/studybuddy-eval-lessons.db npm run eval -- lessons --summary-results evals/results/lessons-<ISO>.json
```

`--limit N` limita le lezioni generate. Il primo comando verifica 5–8 domande guida con fonte valida,
tre domande di pretesting diverse, e segnala domande sì/no, riferimenti nascosti o risposte nella domanda.
Scrive anche domande, attese, passaggi e campi `review`: la validità dello schema **non dimostra**
che una domanda sia utile o fondata; la revisione confronta domanda e risposta con il passaggio.
Le domande guida possono chiedere un confronto o più aspetti: la conversione in carta passa
da `checkCard` e dall'anteprima modificabile, senza salvataggio automatico.

Il secondo comando misura l'accordo su tre riassunti corretti e tre sbagliati, con le domande guida
effettivamente generate e il contesto usato in produzione. Usa `grade-v2` invariato e la domanda
`cornell-summary-v2`; scrive `results/lesson-summaries-<ISO>.json` e fallisce sotto l'80%.

**Misura del 2026-10-14:** 6/6 generazioni complete, 38 domande guida e 18 di pretesting.
Revisione di Codex sui passaggi: 38/38 attese Cornell e 18/18 attese pretesting fondate, domande utili
e comprensibili senza il testo. Riassunti: la prima domanda chiedeva anche vaghi «rapporti principali»
e faceva 4/6, segnando quel requisito come mancante in due sintesi corrette; tolta quella richiesta,
**v2 6/6** sugli stessi casi. È una run su materiale sintetico breve, non una misura sui corsi reali
o sulle lezioni lunghe. Risultati locali gitignored:
`lessons-2026-10-14T17-38-06-292Z.json` e `lesson-summaries-2026-10-14T17-47-27-013Z.json`.

## Correzione degli appunti (`proofread`)

Il set **sintetico e committabile** `fixtures/proofread.json` contiene dodici appunti con refusi noti
(italiano e inglese): accenti e apostrofi, definizioni «Termine: definizione», codice con identificatori
sbagliati di proposito, wikilink e tag, formule, frontmatter, una ripetizione, errori di **contenuto** da
non correggere e una nota interrotta a metà parola. Ogni caso ha il testo di riferimento (`expected`) e
le frasi che devono restare identiche (`keep`).

```bash
DB_PATH=/tmp/studybuddy-eval-proofread.db npm run eval -- proofread [--limit N]
```

Metriche in `lib/evals/proofread.ts`, calcolate in codice (non serve una revisione manuale): distanza in
parole, sensibile ad accenti e apostrofi, fra input e riferimento e fra uscita e riferimento (quota
recuperata, casi identici, casi peggiorati); parole vere tolte; codice/link/formule dell'input non più
identici; frasi `keep` alterate (anche completate: «non volat» ≠ «non volatile»); sezioni scartate dal
controllo. Punteggiatura, maiuscole e titoli non entrano nella distanza.

**Misura del 2026-11-01** (`proofread-v1`, `gemma4:12b`, due run identiche): 97,4% della distanza
recuperata, 11/12 identici al riferimento, 0 peggiorati, 0 parole tolte, 0 codice/link alterati, 0 frasi
da non toccare alterate, 0 sezioni scartate, ~0,4 s per caso. L'unico residuo è «Inizio» → «Iniziò»
(ambiguo: «inizio» è una parola valida). Le prove su un vault reale hanno guidato le regole del controllo
prima del set: righe tolte sotto la soglia del 10% («l'unita' centrale di elaborazione»), titoli
inventati sopra le definizioni («# Computer» + «Computer: …»), righe «Termine: definizione» spezzate in
titolo + testo, la parola che si stava scrivendo completata («oper» → «operazioni»).
