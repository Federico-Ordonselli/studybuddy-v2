import { assertMapDocument, MapError, MAP_SCHEMA_VERSION } from "./formato-mappa.js";

export const newId = () => globalThis.crypto.randomUUID();
const clone = value => structuredClone(value);
const citedFields = () => ({
  sourceRefs: [], reviewStatus: "unverified", provenance: { origin: "manual" },
});

export function createConcept(title = "Nuovo concetto", fields = {}) {
  return {
    id: newId(), title, kind: "concept", definition: "", explanation: "",
    examples: [], tags: [], ...citedFields(), ...clone(fields),
  };
}
export function createPlacement(spaceId, conceptId, fields = {}) {
  return { id: newId(), spaceId, conceptId, x: 0, y: 0, width: 200, height: 100, ...clone(fields) };
}
export function createRelation(sourceConceptId, targetConceptId, predicate, fields = {}) {
  return {
    id: newId(), sourceConceptId, targetConceptId, predicate, label: predicate,
    directed: true, explanation: "", ...citedFields(), ...clone(fields),
  };
}
export function createMapDocument(title = "Nuova mappa", fields = {}) {
  const rootSpaceId = newId();
  return assertMapDocument({
    schemaVersion: MAP_SCHEMA_VERSION, id: newId(), title, revision: 0,
    rootSpaceId, concepts: [], spaces: [{ id: rootSpaceId, title }],
    placements: [], relations: [], assets: [], ...clone(fields),
  });
}

export function indexMap(document) {
  const byId = entries => new Map(entries.map(entry => [entry.id, entry]));
  return {
    concepts: byId(document.concepts), spaces: byId(document.spaces),
    placements: byId(document.placements), relations: byId(document.relations),
    parentPlacement: new Map(document.placements.filter(p => p.childSpaceId)
      .map(p => [p.childSpaceId, p])),
  };
}

/* Il renderer vede il livello corrente. Gli archi verso concetti fuori dalla
   tela restano interrogabili: non scompaiono dal documento né si duplicano. */
export function projectSpace(document, spaceId) {
  const index = indexMap(document);
  if (!index.spaces.has(spaceId)) throw new MapError("missing_space", "Tela inesistente");
  const placements = document.placements.filter(p => p.spaceId === spaceId);
  const visible = new Set(placements.map(p => p.conceptId));
  const internal = [], external = [];
  for (const relation of document.relations) {
    const source = visible.has(relation.sourceConceptId), target = visible.has(relation.targetConceptId);
    if (source && target) internal.push(relation);
    else if (source || target) external.push(relation);
  }
  return clone({
    space: index.spaces.get(spaceId), placements,
    concepts: [...visible].map(id => index.concepts.get(id)), relations: internal, externalRelations: external,
  });
}

export function spaceBreadcrumb(document, spaceId) {
  const index = indexMap(document), result = [], visited = new Set();
  let current = index.spaces.get(spaceId);
  if (!current) throw new MapError("missing_space", "Tela inesistente");
  while (current) {
    if (visited.has(current.id)) throw new MapError("containment_cycle", "Ciclo nel contenimento");
    visited.add(current.id);
    result.unshift(clone(current));
    current = index.spaces.get(index.parentPlacement.get(current.id)?.spaceId);
  }
  return result;
}

export function searchConcepts(document, query) {
  const normalize = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it");
  const term = normalize(query.trim());
  if (!term) return [];
  return document.concepts.filter(c => normalize([c.title, c.definition, ...c.tags].join(" ")).includes(term))
    .map(concept => ({
      concept: clone(concept),
      placements: clone(document.placements.filter(p => p.conceptId === concept.id)),
    }));
}
