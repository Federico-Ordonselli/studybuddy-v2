/** Errore di validazione/organizzazione con lo status HTTP da restituire (route → `{ error }`). */
export class LibraryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Connessione a Ollama fallita, distinta dagli errori del modello. */
export class OllamaUnavailableError extends Error {}
