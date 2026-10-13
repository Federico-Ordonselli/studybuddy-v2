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
npm run eval -- tutor [--limit N]              # prompt corrente (tutor-v1)
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

Da aggiungere con le fasi successive: `maps.jsonl` (Fase 5).
