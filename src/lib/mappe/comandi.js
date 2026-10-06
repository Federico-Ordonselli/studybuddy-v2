/* Ogni comando modifica una copia e valida il risultato. Una proposta con
   più operazioni è atomica: nessuna modifica parziale raggiunge il chiamante. */
import { assertMapDocument, MapError } from "./formato-mappa.js";
import { indexMap, createPlacement, newId } from "./modello.js";

function find(entries, id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) throw new MapError("missing_entity", `Elemento inesistente: ${id}`);
  return entry;
}
function patch(entry, changes, allowed) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new MapError("invalid_patch", "Modifiche richieste");
  for (const key of Object.keys(changes))
    if (!allowed.includes(key)) throw new MapError("invalid_patch", `Campo non modificabile: ${key}`);
  Object.assign(entry, structuredClone(changes));
}

/* Rimuovere una comparsa elimina le sue tele discendenti, ma conserva tutti
   i concetti e le relazioni. I concetti senza comparse restano ricercabili. */
function removePlacements(document, ids) {
  const roots = document.placements.filter(p => ids.has(p.id) && p.childSpaceId).map(p => p.childSpaceId);
  const children = new Map();
  for (const p of document.placements) {
    if (!p.childSpaceId) continue;
    if (!children.has(p.spaceId)) children.set(p.spaceId, []);
    children.get(p.spaceId).push(p.childSpaceId);
  }
  const spaces = new Set(), stack = [...roots];
  while (stack.length) {
    const spaceId = stack.pop();
    if (spaces.has(spaceId)) continue;
    spaces.add(spaceId);
    stack.push(...(children.get(spaceId) || []));
  }
  document.placements = document.placements.filter(p => !ids.has(p.id) && !spaces.has(p.spaceId));
  document.spaces = document.spaces.filter(s => !spaces.has(s.id));
}

function apply(document, command) {
  switch (command.type) {
    case "renameMap":
      document.title = command.title;
      find(document.spaces, document.rootSpaceId).title = command.title;
      break;
    case "addConcept":
      document.concepts.push(structuredClone(command.concept));
      if (command.placement) {
        if (command.placement.conceptId !== command.concept.id)
          throw new MapError("concept_mismatch", "La comparsa deve riferirsi al nuovo concetto");
        document.placements.push(structuredClone(command.placement));
      }
      break;
    case "updateConcept":
      patch(find(document.concepts, command.id), command.changes,
        ["title", "kind", "definition", "explanation", "examples", "tags", "sourceRefs", "reviewStatus", "provenance"]);
      break;
    case "addPlacement":
      document.placements.push(structuredClone(command.placement));
      break;
    case "updatePlacement":
      patch(find(document.placements, command.id), command.changes, ["spaceId", "x", "y", "width", "height"]);
      break;
    case "addChildSpace": {
      const placement = find(document.placements, command.placementId);
      if (placement.childSpaceId) throw new MapError("already_expanded", "La bolla ha già una tela di approfondimento");
      if (command.space.ownerConceptId !== placement.conceptId)
        throw new MapError("owner_mismatch", "La tela deve appartenere al concetto della bolla");
      document.spaces.push(structuredClone(command.space));
      placement.childSpaceId = command.space.id;
      break;
    }
    case "removePlacement":
      find(document.placements, command.id);
      removePlacements(document, new Set([command.id]));
      break;
    case "deleteConcept": {
      find(document.concepts, command.id);
      const placements = document.placements.filter(p => p.conceptId === command.id);
      removePlacements(document, new Set(placements.map(p => p.id)));
      document.concepts = document.concepts.filter(c => c.id !== command.id);
      document.relations = document.relations.filter(r => r.sourceConceptId !== command.id && r.targetConceptId !== command.id);
      // Un'ownerConceptId senza una bolla navigabile può esistere solo sulla radice.
      for (const space of document.spaces)
        if (space.ownerConceptId === command.id) delete space.ownerConceptId;
      break;
    }
    case "addRelation":
      document.relations.push(structuredClone(command.relation));
      break;
    case "updateRelation":
      patch(find(document.relations, command.id), command.changes,
        ["sourceConceptId", "targetConceptId", "predicate", "label", "directed", "explanation", "sourceRefs", "reviewStatus", "provenance"]);
      break;
    case "removeRelation":
      find(document.relations, command.id);
      document.relations = document.relations.filter(r => r.id !== command.id);
      break;
    default:
      throw new MapError("unknown_command", `Comando sconosciuto: ${command.type}`);
  }
}

export function applyMapCommands(document, commands) {
  assertMapDocument(document);
  if (!Array.isArray(commands) || commands.length > 1000)
    throw new MapError("invalid_commands", "Massimo 1.000 comandi per operazione");
  const result = structuredClone(document);
  for (const command of commands) {
    if (!command || typeof command !== "object") throw new MapError("invalid_command", "Comando non valido");
    apply(result, command);
  }
  // La revisione identifica il salvataggio dell'host, non il numero di gesti UI.
  return assertMapDocument(result);
}

/* Duplicare una comparsa significa riusare il concetto, non copiarne la
   definizione. L'approfondimento è un albero nuovo con ID propri. */
export function duplicatePlacementCommands(document, placementId, { targetSpaceId, offsetX = 40, offsetY = 40 } = {}) {
  const index = indexMap(assertMapDocument(document));
  const original = find(document.placements, placementId);
  const target = targetSpaceId ?? original.spaceId;
  find(document.spaces, target);
  const commands = [];
  const children = new Map();
  for (const p of document.placements) {
    if (!children.has(p.spaceId)) children.set(p.spaceId, []);
    children.get(p.spaceId).push(p);
  }
  const pending = [{ original, parentId: target, offset: true }];
  while (pending.length) {
    const item = pending.pop(), p = item.original;
    const copy = createPlacement(item.parentId, p.conceptId, {
      x: p.x + (item.offset ? offsetX : 0), y: p.y + (item.offset ? offsetY : 0),
      width: p.width, height: p.height,
    });
    commands.push({ type: "addPlacement", placement: copy });
    if (p.childSpaceId) {
      const space = { ...index.spaces.get(p.childSpaceId), id: newId() };
      commands.push({ type: "addChildSpace", placementId: copy.id, space });
      for (const child of children.get(p.childSpaceId) || [])
        pending.push({ original: child, parentId: space.id, offset: false });
    }
  }
  return commands;
}
