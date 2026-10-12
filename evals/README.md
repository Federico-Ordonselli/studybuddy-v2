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

Da aggiungere con le fasi successive: `cards.jsonl` (Fase 3), `tutor.jsonl` (Fase 4), `maps.jsonl` (Fase 5).
