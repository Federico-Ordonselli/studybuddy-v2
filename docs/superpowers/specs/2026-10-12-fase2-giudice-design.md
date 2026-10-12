# Fase 2 — Giudice a verdetti — design

Data: 2026-10-12 · Stato: approvato in conversazione (3 sezioni); da rivedere per iscritto
Riferimenti: `StudyBuddy v2 — Piano di lavoro.md` (Fase 2), `evals/README.md` (criterio dei verdetti), baseline `evals/results/2026-10-12-grading-grade-v1.json`.

## Obiettivo

Il giudice smette di dare un voto 0–5 e dà un **verdetto** `wrong | partial | correct`, dopo aver detto cosa chiede la domanda e cosa c'è / manca / è sbagliato nella risposta, con il passaggio sorgente davanti. Il rating FSRS lo calcola il codice, non il modello.

**Fatto quando:** con `PROMPT_VERSION = "grade-v2"`, `npm run eval -- grading` sui 52 casi dà accordo esatto ≥ 80% e **nessun** caso `long-wrong` giudicato `correct`; `npm test`, `npm run typecheck` e `npm run colors:check` passano; la UI è verificata con Playwright su DB temporaneo.

## Differenza dal piano (decisa)

Il piano (2.1) fa elencare i fatti presenti/mancanti **della risposta attesa**. La baseline `grade-v1` mostra che l'errore principale è proprio confrontare con tutta l'attesa (indulgente su near-miss e aggiunte false, severo su dettagli secondari omessi). Quindi il giudice prima dichiara **ciò che la domanda richiede** (`required`) e confronta solo con quello, come dice il criterio di `evals/README.md`.

## 1. Il giudice (`src/lib/tutor/grade.ts`)

Firma: `gradeAnswer(question, expected, studentAnswer, source?: string): Promise<Grade>`.

Schema di output, in quest'ordine (Ollama genera le proprietà in sequenza: il verdetto arriva dopo il ragionamento):

```
required: string[]   // cosa chiede la domanda (1–4 elementi), da domanda + attesa + sorgente
present:  string[]   // elementi richiesti presenti nella risposta (anche con altre parole / in altra lingua)
missing:  string[]   // elementi richiesti assenti
errors:   string[]   // affermazioni false nella risposta, comprese le aggiunte attribuite a ciò che è chiesto
verdict:  "wrong" | "partial" | "correct"
feedback: string     // 2–3 frasi in italiano: cosa manca e perché conta
```

Tipo restituito: `Grade { verdict, required, present, missing, errors, feedback }` (spariscono `quality` e `correct`). `Verdict` esportato da `grade.ts`.

Prompt di sistema: rubrica = criterio di `evals/README.md`:
- **correct**: risponde a ciò che è chiesto, anche con parole diverse o in un'altra lingua; un dettaglio secondario omesso non impedisce correct.
- **partial**: manca, o è sbagliato, un elemento richiesto (anche un'aggiunta falsa attribuita a ciò che è chiesto); negli elenchi/abbinamenti una parte giusta vale partial.
- **wrong**: sbaglia la proprietà centrale, oppure è vuota / "non so".
- Regole: conta il contenuto, non la lingua; più lungo non vale di più (un dettaglio in più sbagliato va in `errors`); se attesa e sorgente non coincidono vale la sorgente.

User message: domanda, risposta attesa, passaggio sorgente (se c'è, delimitato), risposta dello studente.

Validazione in codice (`parseGrade`, esportata per i test): verdetto nell'enum, array di stringhe, `feedback` stringa; altrimenti `null`. **Coerenza**: `correct` con `errors` o `missing` non vuoti → declassato a `partial` (rete contro i "sbagliata ma lunga"; da togliere se l'eval mostra che fa danni).

Invariati: temperatura 0, un retry, `throw` se l'output non è valido (mai un verdetto finto). `PROMPT_VERSION = "grade-v2"`.

## 2. Passaggio sorgente

`gradingSource(...)` in `src/lib/tutor/cards.ts` → `{ text, citation } | null`:
- carta con `sourceChunkId`: contenuto del chunk tagliato a 1500 caratteri;
- altrimenti (carte da quiz, domande aperte del quiz): primo risultato di `retrieve(question, domainId)`;
- `citation` costruita con `toCitations` (stesso formato delle citazioni del tutor, video al minuto incluso).

Un errore del retrieve non blocca il giudizio: si giudica senza sorgente.

## 3. Rating, log, quiz

- `scheduler.ts`: `toRating(verdict)`: wrong → Again, partial → Hard, correct → Good. `ratingFromQuality` eliminata. Easy solo da correzione manuale fino alla Fase 6.
- `reviewCard`: `gradingSource` → `gradeAnswer(…, source)` → `toRating`. Nel log `legacy_quality` non si scrive più (colonna tenuta per le review già fatte, nessuna migrazione); `grader_rationale` = JSON `{ required, present, missing, errors, feedback }` (le righe vecchie restano testo). `ReviewResult` aggiunge `source?: Citation`.
- Correzione del voto: invariata (4 rating, `/api/review/override`).
- `session.ts`: `gradeChoice` (mcq) → `correct`/`wrong` con array vuoti; `gradeTurn(q, answer, domainId)` prende la sorgente con il fallback `retrieve` e restituisce anche la `citation`. La route `/api/chat` passa il `domainId` che riceve già.
- `TutorView`: «Aggiungi al ripasso» quando il verdetto non è `correct` (oggi `quality < 3`).

## 4. Eval

`src/lib/evals/grading.ts`: `verdictFromGrade` diventa la lettura di `grade.verdict`; il giudice riceve il `source` del caso. Metriche invariate. Se il criterio di chiusura non è raggiunto si itera sul **prompt** e i casi sbagliati vengono mostrati all'utente prima di cambiare la rubrica.

## 5. Interfaccia

- Estratti da `TutorView` in `components/study/`: `CitationChip` (pillola con ▶ minuto) e `VideoPanel` (player al minuto). Li usano tutor e ripasso.
- `VerdictPanel` (ReviewView + TutorView): verdetto con testo e icona («✓ Corretta» / «◐ Parziale» / «✗ Sbagliata»), feedback, «Mancava» (`missing`) e «Da correggere» (`errors`) solo se non vuoti, risposta attesa (Ripasso), sorgente come `CitationChip`. Sotto, come ora, rating FSRS + prossima scadenza e «Il voto è sbagliato».
- Colori: `--success` / `--danger` esistenti; nuovi `--warning` / `--warning-soft` in `tokens.css` (dall'ambra del brand) con righe `@check`, dopo aver letto `color-boss/COLOR_BOSS.md` §1, 9, 10. `npm run colors:check` exit 0. I `var(--color-ok)` / `var(--color-danger)` di `TutorView` passano ai token semantici.
- Tipo `Grade` in `components/study/types.ts` allineato.

## 6. Test (`npm test`, senza Ollama)

- `parseGrade`: rifiuta output malformati; declassa `correct` con `missing`/`errors`.
- `toRating`: mappa i tre verdetti.
- `reviewCard` (giudice stubbato): rating giusto, `grader_rationale` JSON, `legacy_quality` NULL, `prompt_version = grade-v2`.
- `gradeChoice`: verdetti.
- `tests/eval-grading.test.ts` aggiornato.

## Fuori da questa fase

Easy legato alla fiducia (Fase 6), rimozione delle colonne SM-2 e di `legacy_quality`, ottimizzazione dei parametri FSRS.
