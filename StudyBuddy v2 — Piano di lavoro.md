# **StudyBuddy v2 — Piano di lavoro**

Oct 12, 2026 · @Federico

## **Obiettivo e principi**

In 6 fasi principali StudyBuddy passa da "genera materiale" a "ti fa lavorare": scheduling FSRS, valutazione affidabile, carte atomiche, tutor che non regala la soluzione, mappe da costruire. Il tutto resta su gemma4:12b in locale, senza chiamate in più dove non servono.

Principi che valgono per tutte le fasi:

* **Prima provi, poi vedi.** Niente funzioni rimosse: riassunti, mappe generate e slide restano, ma diventano la correzione o il ripasso dopo un tentativo, non il punto di partenza.  
* **Ogni modifica a un prompt si misura.** Nessun cambio di prompt va in main senza girare il set di valutazione della Fase 0\.  
* **Codice prima dell'LLM.** Dove un controllo deterministico basta (lunghezza, schema, regex), non si aggiunge una chiamata al modello.  
* **Migrazioni non distruttive.** Lo stato SM-2 esistente si converte, non si butta; le colonne vecchie restano finché FSRS non è stabile.  
* **Test per ogni modulo nuovo**, con lo stesso stile di tests/\*.test.ts (node:test, SQLite temporaneo, LLM finto).

Cosa non si fa, rispetto al report Gemini:

* Niente ottimizzazione del RAG: ricerca ibrida, RRF e reranker ci sono già.  
* Niente interleaving tra domini lontani (es. cybersecurity con frontend): solo tra moduli dello stesso corso o specializzazione.  
* Niente rimozione di riassunti, slide e mappe generate.  
* Niente funzioni basate su capacità di Gemma 4 non verificate (token di ragionamento, visione) prima del controllo della Fase "Punti da verificare".

## **Stato attuale del codice**

La base è buona: il giudice lancia già un errore invece di registrare 0, le mcq si valutano senza LLM e le domande che citano "il testo" vengono scartate. Il buco più grosso è che il giudice non riceve il passaggio sorgente, anche se cards.sourceChunkId è già salvato.

| Area | File | Oggi | Problema |
| :---- | :---- | :---- | :---- |
| Scheduling | src/lib/tutor/sm2.ts | SM-2 classico, quality 0–5, ease min 1.3 | Ease hell; intervallo azzerato a ogni errore; nessun log delle review |
| Stato carte | src/lib/db/schema.ts (cards) | Colonne ease, intervalDays, repetitions, dueAt | Mancano stability, difficulty, state, lapses, last review |
| Ripasso | src/lib/tutor/cards.ts → reviewCard() | Grade → sm2() → update | Sovrascrive lo stato senza storico |
| Giudice | src/lib/tutor/grade.ts | Schema {quality, correct, feedback}, temperature 0, 1 retry | Feedback e voto senza motivazione prima; nessun passaggio sorgente; rubrica vaga ("5 perfetta, 3 sufficiente") |
| Generazione carte | generateCards() → generateQuiz(kind: "open") in quiz.ts | Dedup Jaccard 0.6, filtro "il testo/contesto" | Nessun vincolo di atomicità; stesso prompt dei quiz |
| Tutor | src/lib/tutor/session.ts → socraticOptions() | Prompt di 3 righe, temperature 0.6, streaming | Nessun controllo se la risposta dà la soluzione |
| Mappe | src/lib/conceptmap.ts, src/lib/mappe/\* | L'LLM propone centro, concetti, relazioni | Nessuna modalità in cui le relazioni le scrive lo studente |
| UI ripasso | src/components/study/ReviewView.tsx | Textarea → voto "x/5" | Nessun voto di fiducia |
| Migrazioni | src/lib/db/index.ts → ensureColumn() | ALTER idempotenti all'avvio | Va riusato per le nuove colonne |

## **Fase 0 — Set di valutazione e log delle review**

Prima di toccare prompt o scheduler servono due cose: uno storico di ogni review e un piccolo set di casi fissi da rigirare a ogni modifica. Senza, non sai se un cambio migliora o peggiora.

### **0.1 Tabella review\_logs**

Una riga per ogni review, mai aggiornata dopo l'inserimento. Serve a FSRS (ottimizzazione dei parametri) e a te (calibrazione del giudice e della fiducia).

| Colonna | Tipo | Note |
| :---- | :---- | :---- |
| id | integer PK |  |
| card\_id | integer FK → cards |  |
| reviewed\_at | integer (timestamp) |  |
| rating | integer 1–4 | Again / Hard / Good / Easy (dalla Fase 2\) |
| legacy\_quality | integer 0–5, nullable | Solo finché il giudice usa ancora 0–5 |
| confidence | integer 1–3, nullable | Dalla Fase 6 |
| answer | text | Risposta scritta dallo studente |
| grader\_rationale | text | Motivazione del giudice |
| state\_before, stability, difficulty, scheduled\_days | vari | Copia del ReviewLog di ts-fsrs (Fase 1\) |
| grader\_model, prompt\_version | text | Per confrontare versioni |

Come:

1. Aggiungi la tabella a schema.ts e rigenera schemaSql.ts con npm run db:schema.  
2. Crea la tabella sui DB esistenti con ensureTable() in src/lib/db/index.ts.  
3. In reviewCard() inserisci la riga nella stessa transazione dell'update della carta.  
4. Test: una review produce esattamente una riga; un errore del giudice non ne produce nessuna.

### **0.2 Set di valutazione**

Cartella evals/ con dati in evals/data/ (in .gitignore: contiene estratti di corsi a pagamento) e script scripts/eval.ts lanciato con npm run eval. Usa Ollama vero, quindi resta fuori da npm test.

| File | Contenuto | Metrica |
| :---- | :---- | :---- |
| grading.jsonl | 40 triple domanda / attesa / risposta con il tuo verdetto (wrong / partial / correct). Includi: perfetta, parziale, sbagliata ma lunga, vuota, risposta in italiano a carta inglese, sinonimi | Accordo esatto, accordo entro 1, matrice di confusione |
| cards.jsonl | 30 chunk di trascrizione da 3 corsi diversi | % carte che passano il controllo di atomicità (Fase 3\) \+ tua revisione manuale su 20 |
| tutor.jsonl | 25 conversazioni in cui chiedi la soluzione: diretta, insistente, "scrivimi il codice", "sono di fretta" | % risposte che danno la soluzione (perdita) |
| maps.jsonl | 5 argomenti con le relazioni che consideri corrette | Precisione della valutazione delle proposizioni (Fase 5\) |

Ogni modulo che contiene un prompt espone una costante PROMPT\_VERSION. Lo script salva i risultati in evals/results/\<data\>-\<modulo\>-\<versione\>.json, così confronti due versioni affiancate.

**Fatto quando:** npm run eval \-- grading stampa le metriche del giudice attuale (la baseline).

## **Fase 1 — Da SM-2 a FSRS**

Sostituisci sm2() con ts-fsrs 5.4.2 dietro un modulo scheduler.ts, converti le carte esistenti senza perderle e aggiungi un pulsante per correggere il voto del giudice.

### **1.1 Dipendenza e configurazione**

* npm i ts-fsrs@5.4.2 con versione fissata: la 6.0 è in beta e rimuove elapsed\_days.  
* In src/lib/config.ts aggiungi un blocco srs: requestRetention: 0.9, maximumInterval: 365 giorni, enableFuzz: true (evita che le carte create insieme scadano tutte lo stesso giorno).

### **1.2 Schema**

Nuove colonne su cards, aggiunte con ensureColumn(): fsrs\_state (0 New, 1 Learning, 2 Review, 3 Relearning), stability real, difficulty real, reps, lapses, learning\_steps, scheduled\_days integer, last\_review timestamp. Le colonne SM-2 restano fino alla fine della fase.

### **1.3 Modulo src/lib/tutor/scheduler.ts**

Unico punto che importa ts-fsrs. Funzioni:

* toFsrsCard(row) e fromFsrsCard(card): conversione riga DB ↔ Card di ts-fsrs.  
* schedule(row, rating, now) → { update, log }: chiama f.next(card, now, rating).  
* undoLast(row, log): usa f.rollback(card, log) per la correzione manuale del voto.

reviewCard() in cards.ts chiama schedule() al posto di sm2() e scrive carta e review\_logs nella stessa transazione.

### **1.4 Conversione delle carte esistenti**

Una funzione idempotente in ensureHubSchema() converte solo le righe con fsrs\_state IS NULL:

| Carta SM-2 | Stato FSRS |
| :---- | :---- |
| repetitions \= 0 e mai ripassata | createEmptyCard(), stato New, due invariato |
| Ripassata almeno una volta | Stato Review, stability \= max(intervalDays, 1\), difficulty \= clamp(5 \+ (2.5 − ease) × 4, 1, 10\), last\_review \= dueAt − intervalDays |

La formula della difficoltà è un'approssimazione: con poche carte va bene, e FSRS la corregge alle review successive.

### **1.5 Voti, finché il giudice usa ancora 0–5**

Mappatura temporanea, tolta nella Fase 2: 0–2 → Again, 3 → Hard, 4 → Good, 5 → Easy. Le mcq (gradeChoice) danno Good se giuste e Again se sbagliate, mai Easy: riconoscere un'opzione non prova il richiamo.

### **1.6 Correzione del voto**

In ReviewView.tsx, sotto il risultato, un pulsante "Il voto è sbagliato" con i 4 rating. Chiama POST /api/review/override con cardId e rating: rollback dell'ultima review e rischedulazione. Il log segna overridden \= 1 (nuova colonna di review\_logs), così nel set di valutazione hai gratis casi in cui il giudice ha sbagliato.

### **1.7 Test (tests/fsrs.test.ts)**

* Carta nuova \+ Good → due nel futuro, reps \= 1.  
* Carta in Review \+ Again → lapses \+ 1, stato Relearning.  
* Conversione eseguita due volte → stesso risultato.  
* Override → stato identico a una review fatta subito con il rating corretto.

### **1.8 Dopo**

Con qualche centinaio di review nel log, i parametri FSRS si possono ottimizzare sui tuoi dati (optimizer di open-spaced-repetition). Non serve ora: i parametri di default vanno bene.

**Fatto quando:** i test passano, le carte esistenti hanno uno stato FSRS e sm2.ts non è più importato da nessuna parte.

## **Fase 2 — Giudice affidabile**

Il giudice smette di dare un numero 0–5 e dà un verdetto a 3 livelli (sbagliata, parziale, corretta), dopo aver elencato i fatti presenti e mancanti, con il passaggio sorgente davanti. Il rating FSRS lo calcola il codice, non il modello.

Perché 3 livelli e non 4: un modello non può sapere se per te è stato "facile". La distinzione Good/Easy la decide la tua fiducia (Fase 6); fino ad allora una risposta corretta vale Good.

### **2.1 Nuovo schema di output (grade.ts)**

Le proprietà vanno in quest'ordine, perché l'output strutturato di Ollama le genera in sequenza e il verdetto arriva dopo il ragionamento:

{  
  "facts\_present": \["..."\],  
  "facts\_missing": \["..."\],  
  "errors": \["affermazioni sbagliate nella risposta"\],  
  "verdict": "wrong | partial | correct",  
  "feedback": "2-3 frasi: cosa manca e perché conta"  
}

### **2.2 Input**

gradeAnswer(question, expected, studentAnswer, source?). In reviewCard() il source è il contenuto di cards.sourceChunkId, tagliato a circa 1.500 caratteri. Se la carta non ha sorgente (creata da un quiz), fai un retrieve(question, domainId) e prendi il primo chunk.

### **2.3 Rubrica nel prompt di sistema**

* **wrong:** manca l'idea centrale della risposta attesa, oppure c'è un errore proprio sul punto centrale, oppure è vuota o "non so".  
* **partial:** l'idea centrale c'è, ma manca un elemento essenziale o c'è un errore su un dettaglio.  
* **correct:** ci sono tutti i fatti essenziali della risposta attesa, anche con parole diverse.

Regole aggiuntive, ognuna legata a un caso del set di valutazione:

* Valuta il contenuto, non la lingua: una risposta in italiano a una carta in inglese può essere corretta.  
* Una risposta più lunga non vale di più; un dettaglio in più sbagliato finisce in errors.  
* Se risposta attesa e passaggio sorgente non coincidono, vale il passaggio.

### **2.4 Da verdetto a rating (scheduler.ts)**

toRating(verdict, confidence?): wrong → Again; partial → Hard; correct → Good; correct con fiducia alta → Easy (dalla Fase 6). Togli la mappatura 0–5 della Fase 1.5 e la colonna legacy\_quality smette di essere scritta.

### **2.5 Feedback elaborativo in UI**

In ReviewView.tsx sostituisci "x/5" con il verdetto, l'elenco di cosa mancava e il link al passaggio sorgente. Se il chunk è una trascrizione, il link apre il player al minuto giusto, con lo stesso meccanismo delle citazioni del tutor. Stesso trattamento per le domande aperte del quiz (gradeTurn in session.ts).

### **2.6 Invariati**

Temperature 0, un retry, errore invece di voto finto se l'output non è valido. PROMPT\_VERSION \= "grade-v2".

**Fatto quando:** sul set grading.jsonl l'accordo esatto con i tuoi verdetti è almeno 80%, e nessuna risposta "sbagliata ma lunga" viene giudicata correct.

## **Fase 3 — Flashcard atomiche**

Le carte smettono di usare il prompt dei quiz: un generatore dedicato estrae prima i fatti singoli e poi ne fa una carta ciascuno, un controllo in codice segnala quelle composite, e tu le approvi prima che entrino nel ripasso.

### **3.1 Generatore dedicato: src/lib/tutor/cardGen.ts**

Oggi generateCards() riusa generateQuiz(kind: "open"). Al suo posto, una chiamata con questo schema (i fatti vengono generati prima delle carte):

{  
  "facts": \["un fatto per elemento, una frase"\],  
  "cards": \[  
    { "fact": 0, "type": "qa | cloze", "question": "...", "answer": "...", "source": 3 }  
  \]  
}  
Regole nel prompt:

* Una carta \= un fatto. Una lista di N elementi diventa N carte, oppure nessuna.  
* Risposta di una frase, o un termine, o un frammento di codice.  
* Mescola definizioni ("cos'è") e meccanismi ("perché", "cosa succede se"): le seconde allenano la comprensione.  
* Niente domande sì/no o vero/falso: si indovinano.  
* Cloze solo se la parola tolta non si deduce dal resto della frase.  
* source \= numero \[n\] del passaggio da cui viene il fatto.

Il source dichiarato dal modello sostituisce sourceForAnswer(). Se la sovrapposizione lessicale tra risposta e passaggio indicato è molto bassa, usa sourceForAnswer() come ripiego.

### **3.2 Pulizia della trascrizione**

cleanTranscript(text) in src/lib/rag/, usata solo per generare, non per l'indice. Toglie riempitivi ("um", "uh", "you know", "so basically"), frasi di servizio ("in this video", "in the next lesson", "welcome back") e ripetizioni consecutive. Test con 5 estratti reali.

### **3.3 Controllo in codice: src/lib/tutor/cardQuality.ts**

checkCard(card) restituisce l'elenco dei problemi trovati, senza chiamare l'LLM:

| Controllo | Regola di partenza |
| :---- | :---- |
| Risposta troppo lunga | Più di 25 parole, esclusi i blocchi di codice. Soglia da tarare con il set di valutazione |
| Enumerazione | Domanda con "elenca", "quali sono i", "list", "name the", "what are the N"; oppure risposta con 3+ elementi separati da virgole o righe |
| Domanda doppia | Più di un "?", oppure "e/and" seguito da un interrogativo (come, perché, how, why, what) |
| Sì/no | Inizia con "È vero che", "Is it", "Does", "Can", "Is there" |
| Risposta nella domanda | Sovrapposizione di shingle tra domanda e risposta sopra 0.5 |
| Riferimenti al contesto | Riusa REFERS\_TO\_HIDDEN di quiz.ts |

Le carte con problemi non vengono buttate in silenzio: finiscono nell'anteprima con il motivo accanto.

### **3.4 Anteprima prima del salvataggio**

POST /api/cards con preview: true restituisce le carte senza salvarle. In CardManager.tsx le vedi in lista: quelle valide già spuntate, quelle segnalate deselezionate e con il motivo. Puoi modificarle, spuntarle e salvare. La generazione automatica (autogenerate.ts) salva solo quelle valide, senza anteprima.

Le carte create da un nodo della mappa passano dallo stesso generatore.

**Fatto quando:** sul set cards.jsonl almeno l'85% delle carte passa il controllo e, nella tua revisione manuale di 20 carte, almeno 17 sono da tenere senza modifiche.

## **Fase 4 — Tutor che non regala la soluzione**

Tre interventi: un prompt con una scala di indizi esplicita, un controllo solo sui turni a rischio (quando chiedi la soluzione), e un pulsante "Mostra soluzione" che sblocchi tu, dopo aver provato. Il controllo su tutti i turni costerebbe una chiamata in più ogni volta: non serve.

### **4.1 Prompt con scala di indizi (socraticOptions() in session.ts)**

Il prompt attuale è di 3 righe. Quello nuovo distingue due tipi di richiesta:

* **Domanda di spiegazione** ("cos'è X", "che differenza c'è tra X e Y"): risposta breve con citazioni \[n\], poi una domanda di verifica. Rifiutarsi di spiegare una definizione è solo frustrante.  
* **Esercizio o problema** (codice da scrivere, risposta di un quiz, calcolo, "come risolvo"): si sale per livelli, uno per turno.

| Livello | Cosa fa il tutor |
| :---- | :---- |
| 1 | Chiede cosa hai già provato o capito |
| 2 | Indica il concetto in gioco, con citazione \[n\] |
| 3 | Indica il passo successivo, non quelli dopo |
| 4 | Mostra un esempio svolto su un caso analogo ma diverso |

Il livello corrente si salva in sessions.state (JSON, già presente) e sale solo se il tuo messaggio contiene un tentativo, non una semplice richiesta di soluzione. Regole fisse: mai la risposta finale, mai codice completo oltre 5 righe che risolva l'esercizio.

### **4.2 Controllo sui turni a rischio**

isSolutionRequest(message) in src/lib/tutor/guard.ts: regex su "soluzione", "risposta", "dimmi", "scrivi il codice", "answer", "solution", "write the code", "just tell me". Solo per questi turni:

1. Generi senza streaming; la UI mostra "preparo un indizio…".  
2. Controllo in codice: se la risposta contiene un blocco di codice di più di 6 righe, è una perdita.  
3. Altrimenti checkLeak(question, context, reply): una chiamata con schema { "reason": string, "gives\_solution": boolean }, temperature 0\.  
4. Se c'è perdita, rigeneri una volta aggiungendo al prompt "La risposta precedente dava la soluzione: dai solo il prossimo indizio". Se perde ancora, mostri un indizio fisso di livello 1\.

Gli altri turni restano in streaming come oggi. Salva in sessions.state quante perdite sono state bloccate: ti serve per l'eval.

### **4.3 Pulsante "Mostra soluzione"**

In TutorView.tsx, attivo dopo almeno 2 tuoi tentativi sullo stesso problema. Chiede la soluzione completa con citazioni e la segna nella sessione.

### **4.4 Test**

* isSolutionRequest: 10 frasi positive e 10 negative, in italiano e inglese.  
* Blocco di codice lungo → perdita senza chiamare l'LLM (provider finto).  
* Perdita al primo tentativo → una sola rigenerazione.

**Fatto quando:** sul set tutor.jsonl le perdite scendono sotto il 10% e il tempo medio dei turni a rischio aumenta di meno di 4 secondi.

## **Fase 5 — Mappe in modalità "costruisci tu"**

Accanto alla mappa generata nasce un esercizio: il modello genera la mappa come oggi ma ti mostra solo i concetti e una domanda focale; le relazioni le tracci tu, poi il modello le valuta e solo alla fine vedi la sua versione. Si riusa propose() così com'è: la mappa generata diventa la soluzione nascosta.

### **5.1 Generazione dell'esercizio**

* In conceptmap.ts, generateMap(domainId, topic, { mode: "build" }). Allo schema aggiungi focus\_question: una domanda a cui la mappa risponde (es. "Come fa React a decidere quando ri-renderizzare un componente?").  
* La proposta completa va in una nuova tabella map\_exercises: map\_id, proposal (JSON), focus\_question, created\_at, checked\_at.  
* Il documento della mappa riceve solo i nodi, sparsi sulla tela, senza archi. Le definizioni restano visibili: servono a capire il concetto, non a trovare la relazione.

### **5.2 Licenza: dove mettere il codice**

Il motore delle mappe (src/components/mappe/\*.js, src/lib/mappe/\*.js) è sotto PolyForm Noncommercial. La logica nuova va in file TypeScript separati sotto MIT (src/lib/mapExercise.ts, src/components/study/MapExercise.tsx), che usano il motore solo tramite i comandi atomici esistenti (applyMapCommands). Primo passo: verifica che l'editor permetta già di tracciare un arco con etichetta a mano. Se manca, va aggiunto nel motore, ed è l'unica modifica lì.

### **5.3 Verifica: evaluateMap(exerciseId, propositions)**

Input: le tue proposizioni, cioè terne {from, label, to} lette dal documento della mappa.

1. **Confronto in codice:** per ogni coppia di nodi controlla se esiste nella soluzione, senza badare alla direzione. Ottieni le coppie in comune, quelle solo tue e quelle mancanti.  
2. **Valutazione LLM:** una chiamata unica per tutte le tue proposizioni (massimo 15). Nel contesto ci sono i passaggi sorgente dei due concetti di ogni arco. Schema per proposizione: { "id", "reason", "verdict": "valid | imprecise | wrong", "fix" }. Una proposizione valida che non è nella soluzione resta valida: non esiste una sola mappa giusta.  
3. **Esito a due livelli:**  
   * Prima vedi i verdetti sui tuoi archi e l'elenco delle coppie mancanti, solo i nomi dei concetti, senza etichetta. Puoi correggere e verificare di nuovo.  
   * Poi "Mostra soluzione" sovrappone la mappa generata, con gli archi in più tratteggiati.

### **5.4 Dalle mappe alle carte**

Ogni proposizione wrong offre "Crea carta": domanda "Che relazione c'è tra X e Y?", risposta presa dalla soluzione o dal campo fix. Passa dal controllo della Fase 3\.

### **5.5 Sottolivelli**

Entrare in una bolla di una mappa-esercizio genera il sottolivello con expandConcept() nella stessa modalità: solo nodi, soluzione salvata in map\_exercises.

**Fatto quando:** sul set maps.jsonl il verdetto del valutatore coincide con il tuo in almeno l'80% delle proposizioni.

## **Fase 6 — Fiducia prima della risposta**

Prima di inviare una risposta indichi quanto sei sicuro (3 livelli). Il dato serve a due cose: decidere Good o Easy, e mostrarti in home quanto le tue sensazioni corrispondono ai risultati. Niente streak né badge.

### **6.1 UI e API**

* In ReviewView.tsx, tre pulsanti sotto la textarea: "Non sicuro", "Abbastanza", "Sicuro" (tasti 1, 2, 3). "Invia" resta disattivo finché non ne scegli uno.  
* Stessa cosa per le domande aperte del quiz in TutorView.tsx.  
* POST /api/review accetta confidence (1–3), validato in src/lib/validation.ts, e lo salva in review\_logs.confidence.

### **6.2 Effetto sullo scheduling (toRating in scheduler.ts)**

| Verdetto | Sicuro | Abbastanza | Non sicuro |
| :---- | :---- | :---- | :---- |
| correct | Easy | Good | Good |
| partial | Hard | Hard | Hard |
| wrong | Again | Again | Again |

Un errore dato con "Sicuro" ha un trattamento a parte nella UI: feedback in evidenza e risposta attesa mostrata subito. Gli errori fatti con sicurezza, una volta corretti, tendono a essere ricordati meglio, quindi vale la pena farli notare.

### **6.3 Calibrazione in home**

calibration(domainId, days \= 30\) in src/lib/home.ts, calcolata da review\_logs: per ogni livello di fiducia, la percentuale di risposte corrette. In home un riquadro con tre barre: "Quando dici *Sicuro* hai ragione nel X% dei casi".

Se con almeno 20 review "Sicuro" la percentuale scende sotto il 70%, il riquadro lo segnala con una frase, senza allarmi.

**Fatto quando:** ogni review salva la fiducia, toRating ha test per tutte le 9 combinazioni e il riquadro compare in home.

## **Fase 7 (opzionale) — Interleaving, appunti guidati, pretesting**

Tre aggiunte indipendenti, da fare dopo le fasi 0–6 e solo se le usi davvero. Ognuna riusa pezzi già costruiti.

### **7.1 Interleaving dentro la specializzazione**

Oggi nextDueCard() prende la carta più scaduta. Quando lo scope è una specializzazione:

1. Prendi le 20 carte più scadute.  
2. Ricava il modulo di ognuna: sourceChunkId → chunks.documentId → percorso del documento.  
3. Scegli la più scaduta il cui modulo è diverso da quello dell'ultima carta ripassata.

Solo dentro lo stesso corso o specializzazione: mescolare domini lontani non dà il beneficio, che viene dal dover distinguere argomenti simili. Le carte senza sorgente valgono come "modulo sconosciuto" e non bloccano la scelta.

### **7.2 Appunti guidati (stile Cornell)**

Nuova modalità in StudioView.tsx, accanto a riassunti e slide, per una singola lezione:

1. Il modello genera da 5 a 8 domande guida dalla trascrizione della lezione (stesso schema delle carte, solo domande).  
2. Tu scrivi gli appunti sotto ogni domanda e un riassunto finale di 3–5 frasi.  
3. "Verifica" confronta il tuo riassunto con la trascrizione, con lo stesso stile del giudice della Fase 2: punti coperti, mancanti, errori.  
4. Tutto si salva come nota del corso (notes.ts); ogni domanda guida può diventare una carta.

Il riassunto map-reduce esistente resta disponibile: lo usi dopo, per confronto o per ripassare.

### **7.3 Pretesting prima di una lezione**

Pulsante "Domande prima di guardare" sulla lezione: 3 domande aperte generate dalla lezione, risposte senza voto e senza scheduling. Rispondere prima, anche sbagliando, aiuta a notare i punti giusti durante il video. Riusa generateQuiz(); serve un retrieve limitato a un documento: verifica se src/lib/rag/store.ts lo supporta già, altrimenti aggiungi un filtro per documentId.

## **Ordine, dipendenze e stime**

Totale stimato per le fasi 0–6: tra 16 e 22 giorni di lavoro. L'ordine consigliato è F0 → F1 → F2 → F6, che chiude il ciclo del ripasso in circa 7–10 giorni; poi F3, F4 e F5.

![dipendenze tra le fasi · stime][image1]

dipendenze tra le fasi · stime

F3 e F4 dipendono solo da F0 e si possono fare in parallelo al ripasso; F5 riusa lo stile del giudice (F2) e la creazione di carte (F3). Le stime sono indicative e includono i test.

## **Punti da verificare prima di iniziare**

Sei controlli rapidi, ognuno dei quali può cambiare un pezzo del piano.

* ☐ **Backup del DB** prima della conversione FSRS: riusa il backup online già presente nello script import-vault.  
* ☐ **Ordine delle proprietà nell'output strutturato di Ollama**: genera 10 voti e controlla che facts\_present e facts\_missing arrivino sempre prima di verdict. Se l'ordine non è garantito, dividi in due chiamate solo per il giudice.  
* ☐ **Archi manuali nell'editor delle mappe**: verifica se si può già tracciare un arco con etichetta a mano (decide quanto lavoro c'è nella Fase 5 e se tocca il codice PolyForm).  
* ☐ **Retrieve limitato a un documento** in src/lib/rag/store.ts (serve per 7.2 e 7.3).  
* ☐ **Capacità di Gemma 4** (modalità di ragionamento, visione, audio): controlla la model card ufficiale prima di progettare qualcosa che le usi. Il report Gemini le cita da fonti deboli.  
* ☐ **ts-fsrs 6.0**: quando esce dalla beta, leggi le note di rilascio prima di aggiornare (rimuove elapsed\_days, che il modulo scheduler.ts deve già evitare).

[image1]: <data:image/png;base64,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>