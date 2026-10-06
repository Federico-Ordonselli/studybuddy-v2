/* Da una proposta dell'LLM (concetti + relazioni per titolo) ai comandi della
   mappa. Puro: usato dal server per la mappa iniziale e dal client per gli
   approfondimenti. I titoli già presenti nella mappa vengono riusati (stesso
   concetto in più livelli) invece di duplicare il concetto. */
import { CONCEPT_KINDS } from "./formato-mappa.js";
import { createConcept, createMapDocument, createPlacement, createRelation, newId } from "./modello.js";
import { applyMapCommands } from "./comandi.js";
import { bounds, radialPositions } from "./geometria.js";

const BUBBLE = { width: 220, height: 110 };
const HUB = { width: 250, height: 120 };
const cut = (text, max) => String(text ?? "").trim().slice(0, max);
export const titleKey = text => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "")
  .toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function conceptFields(item, provenance) {
  return {
    kind: CONCEPT_KINDS.includes(item.kind) ? item.kind : "concept",
    definition: cut(item.definition, 2000), explanation: cut(item.explanation, 8000),
    examples: (Array.isArray(item.examples) ? item.examples : []).map(e => cut(e, 500)).filter(Boolean).slice(0, 8),
    tags: [], sourceRefs: (item.sourceRefs ?? []).slice(0, 6), provenance,
  };
}

function relationCommands(document, proposal, byTitle, provenance) {
  const seen = new Set(document.relations.map(r => `${r.sourceConceptId}|${r.targetConceptId}|${r.predicate}`));
  const commands = [];
  for (const r of proposal.relations ?? []) {
    const source = byTitle.get(titleKey(r.from)), target = byTitle.get(titleKey(r.to));
    const predicate = cut(r.label, 48) || "è collegato a";
    const key = `${source}|${target}|${predicate}`;
    if (!source || !target || source === target || seen.has(key)) continue;
    seen.add(key);
    commands.push({ type: "addRelation", relation: createRelation(source, target, predicate, { provenance }) });
  }
  return commands;
}

/** Mappa nuova da una proposta: il primo concetto è il centro della tela iniziale. */
export function mapFromProposal(title, proposal, { provenance = { origin: "llm" } } = {}) {
  const document = createMapDocument(cut(title, 500) || "Nuova mappa");
  const items = dedupe(proposal.concepts ?? []).slice(0, 14);
  const positions = radialPositions(items.length, { hub: true, ...BUBBLE });
  const byTitle = new Map(), commands = [];
  items.forEach((item, i) => {
    const size = i === 0 ? HUB : BUBBLE;
    const concept = createConcept(cut(item.title, 500), conceptFields(item, provenance));
    const at = i === 0 ? { x: -HUB.width / 2, y: -HUB.height / 2 } : positions[i];
    commands.push({ type: "addConcept", concept, placement: createPlacement(document.rootSpaceId, concept.id, { ...at, ...size }) });
    byTitle.set(titleKey(item.title), concept.id);
  });
  const withConcepts = applyMapCommands(document, commands);
  return applyMapCommands(withConcepts, relationCommands(withConcepts, proposal, byTitle, provenance));
}

/**
 * Comandi per riempire l'approfondimento di una bolla. Se la tela non esiste la
 * crea; se è vuota mette il concetto stesso al centro (doppio clic sul centro =
 * uscire) e i nuovi concetti in cerchio, altrimenti li accoda sotto ai presenti.
 */
export function expansionCommands(document, placementId, proposal, { provenance = { origin: "llm" } } = {}) {
  const placement = document.placements.find(p => p.id === placementId);
  if (!placement) throw new Error("Bolla inesistente");
  const commands = [];
  let spaceId = placement.childSpaceId;
  const owner = document.concepts.find(c => c.id === placement.conceptId);
  if (!spaceId) {
    spaceId = newId();
    commands.push({ type: "addChildSpace", placementId, space: { id: spaceId, title: owner.title, ownerConceptId: owner.id } });
  }
  const present = document.placements.filter(p => p.spaceId === spaceId);
  const visible = new Set(present.map(p => p.conceptId));
  const byTitle = new Map(document.concepts.map(c => [titleKey(c.title), c.id]));
  const items = dedupe(proposal.concepts ?? []).filter(item => titleKey(item.title) && titleKey(item.title) !== titleKey(owner.title)).slice(0, 12);

  const empty = present.length === 0;
  const ring = radialPositions(items.length + 1, { hub: true, ...BUBBLE });
  const box = bounds(present);
  const slot = i => empty ? ring[i + 1]
    : { x: box.x + 70 + (i % 4) * (BUBBLE.width + 50), y: box.y + box.height + 40 + Math.floor(i / 4) * (BUBBLE.height + 60) };
  if (empty) commands.push({ type: "addPlacement", placement: createPlacement(spaceId, owner.id, { x: -HUB.width / 2, y: -HUB.height / 2, ...HUB }) });

  let i = 0;
  for (const item of items) {
    const existing = byTitle.get(titleKey(item.title));
    if (existing && visible.has(existing)) continue;
    const at = { ...slot(i++), ...BUBBLE };
    if (existing) {
      commands.push({ type: "addPlacement", placement: createPlacement(spaceId, existing, at) });
    } else {
      const concept = createConcept(cut(item.title, 500), conceptFields(item, provenance));
      commands.push({ type: "addConcept", concept, placement: createPlacement(spaceId, concept.id, at) });
      byTitle.set(titleKey(item.title), concept.id);
    }
    visible.add(byTitle.get(titleKey(item.title)));
  }
  // Le relazioni si risolvono sul documento con i nuovi concetti già aggiunti.
  const next = applyMapCommands(document, commands);
  return { spaceId, commands: [...commands, ...relationCommands(next, proposal, byTitle, provenance)] };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = titleKey(item?.title);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
