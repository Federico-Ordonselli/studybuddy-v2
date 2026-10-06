/* Contratto neutro: niente DOM, dataset D&D o backend. Versione obbligatoria:
   i documenti campagna non vengono reinterpretati come mappe di studio. */
export const MAP_SCHEMA_VERSION = 1;
export const MAP_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024, concepts: 5000, spaces: 5001, placements: 10000,
  relations: 20000, assets: 500, depth: 64, jsonDepth: 16, values: 500000,
  title: 500, text: 50000, id: 120, coordinate: 1000000,
});
export const CONCEPT_KINDS = Object.freeze(["concept", "definition", "example", "question", "note"]);
export const REVIEW_STATUSES = Object.freeze(["unverified", "verified"]);

export class MapError extends Error {
  constructor(code, message, path = "$") {
    super(message);
    this.name = "MapError";
    this.code = code;
    this.path = path;
  }
}
const fail = (code, message, path) => { throw new MapError(code, message, path); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const optional = rule => ({ optional: rule });
const list = (rule, max) => ({ list: rule, max });
const enumeration = values => ({ enumeration: values });
const string = max => ({ string: max });
const number = (min, max, integer = false) => ({ number: [min, max], integer });
const id = { id: true };
const text = string(MAP_LIMITS.text);
const title = string(MAP_LIMITS.title);
const revision = number(0, Number.MAX_SAFE_INTEGER, true);

const sourceRef = {
  documentId: id, documentRevision: string(120), chunkId: id,
  page: optional(number(1, 1000000, true)), section: optional(title),
  start: optional(number(0, Number.MAX_SAFE_INTEGER, true)),
  end: optional(number(0, Number.MAX_SAFE_INTEGER, true)), excerpt: optional(string(2000)),
};
const provenance = {
  origin: enumeration(["manual", "import", "llm"]),
  jobId: optional(id), createdAt: optional(string(64)),
  model: optional(title), promptVersion: optional(string(120)),
};
const cited = {
  sourceRefs: list(sourceRef, 100), reviewStatus: enumeration(REVIEW_STATUSES),
  provenance,
};
const concept = {
  id, title, kind: enumeration(CONCEPT_KINDS), definition: text, explanation: text,
  examples: list(text, 100), tags: list(string(120), 100), ...cited,
};
const space = { id, title, ownerConceptId: optional(id) };
const placement = {
  id, spaceId: id, conceptId: id, childSpaceId: optional(id),
  x: number(-MAP_LIMITS.coordinate, MAP_LIMITS.coordinate),
  y: number(-MAP_LIMITS.coordinate, MAP_LIMITS.coordinate),
  width: number(80, 4000), height: number(40, 4000),
};
const relation = {
  id, sourceConceptId: id, targetConceptId: id, predicate: string(120),
  label: title, directed: { boolean: true }, explanation: text, ...cited,
};
const schema = {
  schemaVersion: enumeration([MAP_SCHEMA_VERSION]), id, title, revision,
  rootSpaceId: id, concepts: list(concept, MAP_LIMITS.concepts),
  spaces: list(space, MAP_LIMITS.spaces), placements: list(placement, MAP_LIMITS.placements),
  relations: list(relation, MAP_LIMITS.relations),
  assets: list({ id, mediaType: string(120), storageRef: string(2000) }, MAP_LIMITS.assets),
};

function check(value, rule, path) {
  if (rule.optional) {
    if (value !== undefined) check(value, rule.optional, path);
    return;
  }
  if (rule.id === true) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value))
      fail("invalid_id", "ID non valido", path);
  } else if (rule.string !== undefined) {
    if (typeof value !== "string" || value.length > rule.string)
      fail("invalid_string", `Testo richiesto, massimo ${rule.string} caratteri`, path);
  } else if (rule.number) {
    if (!Number.isFinite(value) || value < rule.number[0] || value > rule.number[1] ||
        (rule.integer && !Number.isSafeInteger(value)))
      fail("invalid_number", "Numero fuori dai limiti", path);
  } else if (rule.boolean) {
    if (typeof value !== "boolean") fail("invalid_boolean", "Booleano richiesto", path);
  } else if (rule.enumeration) {
    if (!rule.enumeration.includes(value)) fail("invalid_value", "Valore non ammesso", path);
  } else if (rule.list) {
    if (!Array.isArray(value) || value.length > rule.max)
      fail("invalid_array", `Elenco richiesto, massimo ${rule.max} elementi`, path);
    for (const [i, entry] of value.entries()) check(entry, rule.list, `${path}[${i}]`);
  } else {
    if (!object(value)) fail("invalid_object", "Oggetto richiesto", path);
    for (const key of Object.keys(value))
      if (!Object.hasOwn(rule, key)) fail("unknown_field", `Campo sconosciuto: ${key}`, `${path}.${key}`);
    for (const [key, field] of Object.entries(rule)) check(value[key], field, `${path}.${key}`);
  }
}

/* La scansione precede clone e serializzazione: un chiamante JS può passare
   cicli, BigInt, NaN o oggetti non JSON anche senza usare l'import da file. */
function scan(value) {
  const seen = new Set();
  const stack = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++count > MAP_LIMITS.values || item.depth > MAP_LIMITS.jsonDepth)
      fail("json_limits", "Struttura JSON troppo grande o profonda");
    const v = item.value;
    if (v === null || typeof v === "string" || typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) continue;
    if (typeof v !== "object") fail("not_json", "Il documento deve contenere soltanto valori JSON");
    if (seen.has(v)) fail("not_json", "Riferimenti circolari o condivisi: fornire un documento JSON");
    seen.add(v);
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      fail("not_json", "Oggetto non JSON");
    for (const child of Object.values(v)) stack.push({ value: child, depth: item.depth + 1 });
  }
}

export function assertMapDocument(document) {
  scan(document);
  if (document?.schemaVersion !== MAP_SCHEMA_VERSION)
    fail("unsupported_schema_version", "Versione mappa non supportata", "$.schemaVersion");
  check(document, schema, "$");
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAP_LIMITS.bytes)
    fail("document_too_large", "Documento oltre il limite di 8 MiB");

  const allIds = new Set([document.id]);
  const index = (entries, name) => new Map(entries.map((entry, i) => {
    if (allIds.has(entry.id)) fail("duplicate_id", "ID duplicato", `$.${name}[${i}].id`);
    allIds.add(entry.id);
    return [entry.id, entry];
  }));
  const concepts = index(document.concepts, "concepts");
  const spaces = index(document.spaces, "spaces");
  index(document.placements, "placements");
  index(document.relations, "relations");
  index(document.assets, "assets");
  const reference = (map, key, path) => {
    if (!map.has(key)) fail("missing_reference", `Riferimento inesistente: ${key}`, path);
  };
  reference(spaces, document.rootSpaceId, "$.rootSpaceId");
  for (const [i, s] of document.spaces.entries())
    if (s.ownerConceptId !== undefined) reference(concepts, s.ownerConceptId, `$.spaces[${i}].ownerConceptId`);

  const parents = new Map();
  const children = new Map();
  for (const [i, p] of document.placements.entries()) {
    const path = `$.placements[${i}]`;
    reference(spaces, p.spaceId, `${path}.spaceId`);
    reference(concepts, p.conceptId, `${path}.conceptId`);
    if (p.childSpaceId === undefined) continue;
    reference(spaces, p.childSpaceId, `${path}.childSpaceId`);
    if (p.childSpaceId === document.rootSpaceId)
      fail("containment_cycle", "La tela iniziale non può essere contenuta", path);
    if (parents.has(p.childSpaceId)) fail("multiple_parents", "Una tela ha un solo padre", path);
    const child = spaces.get(p.childSpaceId);
    if (child.ownerConceptId !== p.conceptId)
      fail("owner_mismatch", "La tela di approfondimento appartiene al concetto della bolla", path);
    parents.set(p.childSpaceId, p.spaceId);
    if (!children.has(p.spaceId)) children.set(p.spaceId, []);
    children.get(p.spaceId).push(p.childSpaceId);
  }
  const visited = new Set();
  const pending = [{ id: document.rootSpaceId, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current.id)) fail("containment_cycle", "Ciclo nel contenimento");
    if (current.depth > MAP_LIMITS.depth) fail("tree_too_deep", "Massimo 64 livelli di approfondimento");
    visited.add(current.id);
    for (const child of children.get(current.id) || []) pending.push({ id: child, depth: current.depth + 1 });
  }
  if (visited.size !== spaces.size)
    fail("unreachable_space", "Tela isolata o ciclo non raggiungibile dalla radice");

  for (const [i, r] of document.relations.entries()) {
    reference(concepts, r.sourceConceptId, `$.relations[${i}].sourceConceptId`);
    reference(concepts, r.targetConceptId, `$.relations[${i}].targetConceptId`);
    if (!r.predicate.trim()) fail("empty_predicate", "Specificare il significato della relazione", `$.relations[${i}].predicate`);
  }
  for (const entry of [...document.concepts, ...document.relations])
    for (const ref of entry.sourceRefs) {
      if (!ref.documentRevision.trim()) fail("invalid_source", "Specificare la revisione della fonte");
      if ((ref.start === undefined) !== (ref.end === undefined) ||
          (ref.start !== undefined && ref.end < ref.start))
        fail("invalid_source_range", "Intervallo della citazione non valido");
    }
  return document;
}

export function validateMapDocument(document) {
  try {
    assertMapDocument(document);
    return { ok: true, value: document };
  } catch (error) {
    if (!(error instanceof MapError)) throw error;
    return { ok: false, error: { code: error.code, message: error.message, path: error.path } };
  }
}

export function parseMapJson(json) {
  if (typeof json !== "string") fail("invalid_json", "JSON testuale richiesto");
  if (new TextEncoder().encode(json).byteLength > MAP_LIMITS.bytes)
    fail("document_too_large", "Documento oltre il limite di 8 MiB");
  let document;
  try { document = JSON.parse(json); }
  catch { fail("invalid_json", "JSON non valido"); }
  return assertMapDocument(document);
}

export function serializeMapDocument(document) {
  // Usare la stessa rappresentazione su cui si misura il tetto dei byte.
  return JSON.stringify(assertMapDocument(document));
}
