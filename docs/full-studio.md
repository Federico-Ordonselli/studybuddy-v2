# Full Studio nella libreria di StudyBuddy

Il convertitore legge `content/*/structure.json` e `lesson.json` di un progetto
Full Studio e prepara normali corsi HTML. Non esegue gli script del progetto
sorgente, non apre database e non richiede Ollama per la conversione.

```bash
npm run prepare:full-studio
# Oppure percorsi espliciti (destinazione nuova):
npm run prepare:full-studio -- /percorso/progetto "/percorso/libreria/Materiale"
```

La sorgente predefinita è `Full_studio/`, la destinazione è
`<STUDYBUDDY_LIBRARY_DIR o Courses>/Full Studio`. La destinazione deve essere
nuova: il comando rifiuta di sovrascrivere file esistenti. Per preparare una
nuova versione scegliere una destinazione diversa e gestire l'importazione
dall'anteprima; non aggiorna automaticamente un corso precedentemente importato.

Aprire **Corsi → Aggiungi corso** (`/corsi/add`) e analizzare la libreria:
Full Studio viene riconosciuto come macro, ogni parte come corso, ogni capitolo
come modulo e ogni sezione come lezione. Nell'anteprima assegnare i domini e
confermare l'importazione. I file preparati devono essere accessibili anche al
server StudyBuddy (con Docker la libreria va montata come per gli altri corsi).

L'importazione normale calcola gli embedding tramite il provider configurato
(locale per impostazione predefinita). Dopo l'importazione sono disponibili tutor,
quiz, flashcard, riassunti, mappe, slide e attività per lezione, con gli stessi
flussi degli altri corsi.

I documenti includono testo originale, tabelle, liste, note, codice originale e
copione leggibile; le sezioni aggiunte dal copione vengono mantenute. Gli indici
marcati `front` sono esclusi. La fonetica `tts`, gli audio e i quiz precompilati
non vengono importati: i quiz di StudyBuddy sono generati dal materiale. Non
viene integrato il player audio sincronizzato. Piper non è necessario in questa
fase. La conversione supporta i blocchi paragraph, code, list, table e callout;
un blocco sconosciuto o un riferimento codice mancante interrompe la preparazione.

`Full_studio/` e i corsi generati sono esclusi da Git; il progetto Vite affiancato
è escluso dal typecheck di StudyBuddy. I test del convertitore usano esempi
sintetici e un DB temporaneo, senza dipendere dai materiali personali.

## Lezioni audio dentro StudyBuddy (pagina Full Studio)

Oltre al testo, una lezione della pipeline si può pubblicare come **pacchetto** nella cartella di un corso:

```bash
npm run prepare:full-studio -- package Full_studio/content/part11 "Courses/Corso/01_Capitolo" \
  --md percorso/Capitolo_01.md        # facoltativo: copia la fonte accanto (ingerita come Markdown)
```

Il comando scrive `<modulo>/studio/` (`lesson.json`, `study.json` se c'è, `audio/partN/*.mp3`), sostituendo
solo quella cartella. All'import del corso (`/corsi/add`) il pacchetto registra la lezione in
`studio_lessons` senza generare chunk: il testo da cercare arriva dal `.md` o dall'HTML accanto.

`content/partN/study.json` (scritto nella pipeline, come il copione) contiene carte e domande **per sezione**:

```json
{ "version": 1, "sections": { "p11-ch01-s00": {
  "cards": [{ "q": "Che cos'è un sistema?", "a": "Un insieme di componenti che a ogni richiesta (input) fanno corrispondere una risposta (output)." }],
  "quiz":  [{ "q": "…", "options": ["…", "…", "…", "…"], "answer": 1, "why": "…" }] } } }
```

Le carte nascono **sospese** e si sbloccano quando la sezione è ascoltata (fine dell'ultima frase o «Segna
come ascoltata»); il quiz della pagina pesca solo dalle sezioni ascoltate, metà dalle ultime due. Le domande
di fine capitolo di `lesson.json` entrano nella pool con l'ultima sezione del capitolo. La pagina è
`/full-studio` (voce «Full Studio» nella sidebar); l'audio passa da `/api/studio/audio`, solo file dentro
`studio/` di una lezione registrata.
