import { assertMapDocument, MapError } from "./formato-mappa.js";
import { applyMapCommands } from "./comandi.js";

/* Stato UI fuori dal documento. Le revisioni appartengono alla persistenza;
   undo/redo non devono ripristinare una vecchia revisione del server. */
const snapshot = document => structuredClone(document);
const fingerprint = document => JSON.stringify({ ...document, revision: 0 });

export function createMapSession(initialDocument, { historyLimit = 50 } = {}) {
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 200)
    throw new MapError("invalid_history_limit", "La cronologia contiene da 1 a 200 operazioni");
  let document = snapshot(assertMapDocument(initialDocument));
  let undoStack = [], redoStack = [];
  let savedFingerprint = fingerprint(document);
  let saving = false;
  let changeVersion = 0;
  const listeners = new Set();
  const ui = { spaceId: document.rootSpaceId, selectedPlacementId: null };

  function reconcileUi() {
    if (!document.spaces.some(s => s.id === ui.spaceId)) ui.spaceId = document.rootSpaceId;
    if (!document.placements.some(p => p.id === ui.selectedPlacementId && p.spaceId === ui.spaceId))
      ui.selectedPlacementId = null;
  }
  function status() {
    return {
      dirty: fingerprint(document) !== savedFingerprint,
      canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, saving,
      documentId: document.id, revision: document.revision, changeVersion,
      ui: { ...ui },
    };
  }
  function emit(type) {
    // I listener osservano dati copiati; un errore del consumer non deve far
    // sembrare fallita una modifica già applicata o un salvataggio concluso.
    for (const listener of listeners) {
      try { listener({ type, ...status() }); }
      catch (error) { globalThis.console?.error("Listener della mappa fallito", error); }
    }
  }
  function restore(target) {
    document = { ...target, revision: document.revision };
    changeVersion++;
    reconcileUi();
    emit("documentChanged");
  }

  return {
    getDocument: () => snapshot(document),
    getStatus: status,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Listener richiesto");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    execute(commands, { expectedRevision, expectedChangeVersion, expectedDocumentId } = {}) {
      if (expectedDocumentId !== undefined && expectedDocumentId !== document.id)
        throw new MapError("document_conflict", "La proposta appartiene a un'altra mappa");
      if (expectedRevision !== undefined && expectedRevision !== document.revision)
        throw new MapError("revision_conflict", "La proposta appartiene a una revisione precedente");
      if (expectedChangeVersion !== undefined && expectedChangeVersion !== changeVersion)
        throw new MapError("content_conflict", "La mappa è stata modificata dopo la richiesta");
      const next = applyMapCommands(document, commands);
      if (fingerprint(next) === fingerprint(document)) return false;
      undoStack.push(document);
      if (undoStack.length > historyLimit) undoStack.shift();
      redoStack = [];
      document = next;
      changeVersion++;
      reconcileUi();
      emit("documentChanged");
      return true;
    },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(document);
      restore(undoStack.pop());
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(document);
      restore(redoStack.pop());
      return true;
    },
    loadDocument(next) {
      if (saving) throw new MapError("save_in_progress", "Attendere il salvataggio prima di cambiare documento");
      document = snapshot(assertMapDocument(next));
      changeVersion++;
      undoStack = []; redoStack = [];
      ui.spaceId = document.rootSpaceId; ui.selectedPlacementId = null;
      savedFingerprint = fingerprint(document);
      emit("documentChanged");
    },
    navigate(spaceId) {
      if (!document.spaces.some(s => s.id === spaceId)) throw new MapError("missing_space", "Tela inesistente");
      ui.spaceId = spaceId; ui.selectedPlacementId = null;
      emit("selectionChanged");
    },
    select(placementId) {
      if (placementId !== null && !document.placements.some(p => p.id === placementId && p.spaceId === ui.spaceId))
        throw new MapError("missing_placement", "Bolla non presente nella tela corrente");
      ui.selectedPlacementId = placementId;
      emit("selectionChanged");
    },
    async save(adapter) {
      if (saving) throw new MapError("save_in_progress", "Un salvataggio è già in corso");
      const submitted = snapshot(document);
      saving = true; emit("saveStatusChanged");
      try {
        const saved = await adapter.saveDocument(submitted, submitted.revision);
        assertMapDocument(saved);
        if (saved.id !== submitted.id || saved.revision <= submitted.revision ||
            fingerprint(saved) !== fingerprint(submitted))
          throw new MapError("invalid_save_ack", "Il salvataggio deve restituire lo stesso documento con revisione incrementata");
        document.revision = saved.revision;
        savedFingerprint = fingerprint(submitted);
        // Eventuali modifiche eseguite durante l'attesa rimangono dirty.
        return snapshot(saved);
      } finally {
        saving = false;
        emit("saveStatusChanged");
      }
    },
    destroy() { listeners.clear(); },
  };
}
