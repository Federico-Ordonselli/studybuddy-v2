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

Rubrica (la stessa del giudice della Fase 2):
- **wrong**: manca l'idea centrale, c'è un errore proprio sul punto centrale, oppure è vuota / "non so".
- **partial**: l'idea centrale c'è, ma manca un elemento essenziale o c'è un errore su un dettaglio.
- **correct**: ci sono tutti i fatti essenziali, anche con parole diverse o in un'altra lingua.

Metriche: accordo esatto, accordo entro 1 (wrong < partial < correct), matrice di confusione
e numero di casi `long-wrong` promossi a `correct` (obiettivo della Fase 2: 0, con accordo esatto ≥ 80%).
Il giudice attuale (`grade-v1`) dà un voto 0–5, convertito con 0–2 → wrong, 3 → partial, 4–5 → correct.

Da aggiungere con le fasi successive: `cards.jsonl` (Fase 3), `tutor.jsonl` (Fase 4), `maps.jsonl` (Fase 5).
