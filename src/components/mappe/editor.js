import { createMapSession } from '@/lib/mappe/sessione.js';
import { createConcept, createPlacement, createRelation, indexMap, projectSpace, spaceBreadcrumb, searchConcepts, newId } from '@/lib/mappe/modello.js';
import { duplicatePlacementCommands } from '@/lib/mappe/comandi.js';
import { CONCEPT_KINDS } from '@/lib/mappe/formato-mappa.js';
import { layoutCommands } from '@/lib/mappe/geometria.js';
import { expansionCommands } from '@/lib/mappe/proposte.js';
import { createCanvas } from './tela.js';
import { element, button, field } from './dom.js';

const kindLabels = { concept: 'Concetto', definition: 'Definizione', example: 'Esempio', question: 'Domanda', note: 'Nota' };
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* L'host fornisce il contenitore e gli adattatori. Nessun selettore globale,
   CSS confinato, nessun servizio AI o storage imposto all'host.
   Adattatori: saveDocument, resolveSource, requestQuiz, askTutor, expandConcept. */
export function mount(container, { document: initialDocument, adapters = {}, readOnly = false, onEvent = () => {} } = {}) {
  const session = createMapSession(initialDocument), listeners = new Set();
  const root = element('section', { class: 'studio-editor', 'aria-label': 'Editor della mappa concettuale' });
  const sidebar = element('aside', { class: 'studio-outline', 'aria-label': 'Concetti della mappa' });
  const results = element('div', { class: 'studio-tree' });
  const search = element('input', { type: 'search', placeholder: 'Cerca concetti…', 'aria-label': 'Cerca concetti in tutta la mappa' });
  const main = element('div', { class: 'studio-main' });
  const crumbs = element('nav', { class: 'studio-crumbs', 'aria-label': 'Percorso della tela' });
  const toolbar = element('div', { class: 'studio-toolbar', 'aria-label': 'Modifica della mappa' });
  const area = element('div', { class: 'studio-canvas-area' });
  const inspector = element('aside', { class: 'studio-inspector', 'aria-label': 'Scheda concetto' });
  const notice = element('div', { class: 'studio-notice', role: 'status', 'aria-live': 'polite' });
  const undo = button('↶ Annulla', () => act(() => session.undo()));
  const redo = button('↷ Ripeti', () => act(() => session.redo()));
  const titleInput = element('input', { class: 'studio-map-title', 'aria-label': 'Titolo della mappa', maxlength: 500, readonly: readOnly });
  titleInput.value = initialDocument.title;
  titleInput.addEventListener('change', () => act(() => session.execute([{ type: 'renameMap', title: titleInput.value.trim() || 'Nuova mappa' }])));
  sidebar.append(field('Mappa', titleInput), search, element('h2', { text: 'Concetti' }), results);
  const back = button('↑ Esci', () => act(() => goUp()), { title: 'Torna al livello superiore (Esc)' });
  const add = button('+ Concetto', () => act(addConcept), { class: 'primary', disabled: readOnly });
  const grow = button('✦ Espandi dal materiale', () => act(() => expandCurrent()), { disabled: readOnly || !adapters.expandConcept, title: 'Aggiunge a questo livello altri sotto-concetti trovati nel materiale' });
  const reuse = button('Riusa concetto', () => act(showReuse), { disabled: readOnly });
  toolbar.append(back, add, grow, reuse, button('Disponi', () => act(() => {
    session.execute(layoutCommands(projectSpace(session.getDocument(), session.getStatus().ui.spaceId).placements)); canvas.fit();
  }), { disabled: readOnly }), undo, redo);
  main.append(crumbs, toolbar, area, notice);
  root.append(sidebar, main, inspector); container.append(root);
  let destroyed = false, inspectorKey = '', searchTerm = '', lastSpace = '', lastDocument = initialDocument.id;
  let moving = false, transition = null, generating = 0;
  function emit(type, detail = {}) {
    if (destroyed) return;
    const event = { type, ...detail };
    for (const fn of [onEvent, ...listeners]) {
      try { fn(event); } catch (error) { console.error('Listener editor fallito', error); }
    }
  }
  function message(text, error = false) { notice.textContent = text; notice.classList.toggle('error', error); }
  function act(fn) {
    if (destroyed) return;
    try {
      const result = fn();
      if (result instanceof Promise) result.catch(error => { if (!destroyed) message(error.message, true); });
      return result;
    } catch (error) { message(error.message, true); return false; }
  }
  function execute(commands) { if (!readOnly) return session.execute(commands); return false; }
  const canvas = createCanvas(area, {
    readOnly,
    select: id => act(() => session.select(id)),
    enter: id => act(() => deepen(id)),
    portal: conceptId => act(() => jumpTo(conceptId)),
    move: (id, changes) => { act(() => execute([{ type: 'updatePlacement', id, changes }])); renderCanvas(); },
  });
  const space = () => indexMap(session.getDocument()).spaces.get(session.getStatus().ui.spaceId);
  function selected() {
    const doc = session.getDocument(), p = doc.placements.find(p => p.id === session.getStatus().ui.selectedPlacementId);
    return { doc, p, c: doc.concepts.find(c => c.id === p?.conceptId) };
  }

  /* --- Navigazione fra livelli, con le transizioni della tela --- */
  async function navigate(spaceId, hint, animate) {
    if (moving || spaceId === session.getStatus().ui.spaceId) return;
    moving = true;
    try {
      await animate?.();
      transition = hint;
      session.navigate(spaceId);
    } finally { moving = false; transition = null; }
  }
  /** Bolla del livello `targetSpaceId` da cui si scende verso il livello corrente. */
  function viaPlacement(targetSpaceId) {
    const index = indexMap(session.getDocument());
    let current = session.getStatus().ui.spaceId;
    while (current) {
      const parent = index.parentPlacement.get(current);
      if (!parent) return null;
      if (parent.spaceId === targetSpaceId) return parent.id;
      current = parent.spaceId;
    }
    return null;
  }
  function goTo(spaceId) {
    const via = viaPlacement(spaceId);
    if (via) return navigate(spaceId, { kind: 'out', placementId: via }, () => canvas.zoomAway());
    return navigate(spaceId, { kind: 'jump' }, () => canvas.fade());
  }
  function goUp() {
    const parent = indexMap(session.getDocument()).parentPlacement.get(session.getStatus().ui.spaceId);
    return parent ? goTo(parent.spaceId) : undefined;
  }
  /** Entrare in una bolla: zoom dentro, poi il suo livello. Un livello nuovo viene riempito dal materiale. */
  async function deepen(id) {
    if (moving) return;
    const doc = session.getDocument(), p = doc.placements.find(p => p.id === id);
    if (!p) return;
    // Il concetto al centro del proprio approfondimento: doppio clic = uscire.
    if (p.conceptId === space()?.ownerConceptId) return goUp();
    let spaceId = p.childSpaceId, created = false;
    if (!spaceId) {
      if (readOnly) return;
      spaceId = newId(); created = true;
    }
    // Lo spazio si crea prima dello zoom: il ridisegno a metà animazione perderebbe la bolla evidenziata.
    if (created) execute([{ type: 'addChildSpace', placementId: p.id, space: { id: spaceId, title: doc.concepts.find(c => c.id === p.conceptId).title, ownerConceptId: p.conceptId } }]);
    await navigate(spaceId, { kind: 'in' }, () => canvas.zoomInto(p.id));
    // Livello nuovo o rimasto vuoto: lo riempie il materiale.
    const empty = !session.getDocument().placements.some(q => q.spaceId === spaceId);
    if (empty && adapters.expandConcept && !readOnly) await expand(p.id);
  }
  /** Porta a una comparsa del concetto (nel livello corrente se c'è), come un link. */
  async function jumpTo(conceptId) {
    const doc = session.getDocument(), here = session.getStatus().ui.spaceId;
    const candidates = doc.placements.filter(p => p.conceptId === conceptId);
    const p = candidates.find(p => p.spaceId === here) || candidates[0];
    if (!p) return focusConcept(conceptId);
    if (p.spaceId !== here) {
      const via = viaPlacement(p.spaceId);
      if (via) await navigate(p.spaceId, { kind: 'out', placementId: via }, () => canvas.zoomAway());
      else await navigate(p.spaceId, { kind: 'jump' }, () => canvas.fade());
    }
    if (session.getStatus().ui.spaceId === p.spaceId) session.select(p.id);
  }

  /* --- Generazione dal materiale (adattatore expandConcept dell'host) --- */
  async function expand(placementId) {
    const doc = session.getDocument(), p = doc.placements.find(p => p.id === placementId);
    const concept = doc.concepts.find(c => c.id === p?.conceptId);
    if (!p || !concept || !adapters.expandConcept) return;
    generating++; canvas.busy(`Esploro «${concept.title}» nel materiale…`); message('');
    try {
      const path = spaceBreadcrumb(doc, p.spaceId).map(s => s.title).filter(Boolean);
      const proposal = await adapters.expandConcept({
        mapId: doc.id, conceptId: concept.id, concept: { title: concept.title, definition: concept.definition },
        path, existing: doc.concepts.map(c => c.title),
        present: p.childSpaceId ? doc.placements.filter(q => q.spaceId === p.childSpaceId).map(q => doc.concepts.find(c => c.id === q.conceptId)?.title).filter(Boolean) : [],
      });
      if (destroyed) return;
      // Calcolata sul documento attuale: nel frattempo si può continuare a lavorare.
      const { commands } = expansionCommands(session.getDocument(), placementId, proposal, { provenance: { origin: 'llm', createdAt: new Date().toISOString() } });
      const added = commands.filter(c => c.type === 'addConcept' || c.type === 'addPlacement').length;
      if (!added) { message('Il materiale non ha aggiunto nulla di nuovo a questo concetto.'); return; }
      execute(commands);
      canvas.fit();
      message(`Aggiunti ${added} concetti dal materiale (da verificare). Annulla per toglierli.`);
    } catch (error) {
      if (!destroyed) message(`Generazione non riuscita: ${error.message}`, true);
    } finally {
      generating--; if (!generating && !destroyed) canvas.busy(null);
    }
  }
  function expandCurrent() {
    const parent = indexMap(session.getDocument()).parentPlacement.get(session.getStatus().ui.spaceId);
    if (!parent) { message('Al livello principale entra in una bolla per approfondirla dal materiale.'); return; }
    return expand(parent.id);
  }

  function addConcept() {
    const concept = createConcept();
    const placement = createPlacement(session.getStatus().ui.spaceId, concept.id, { ...canvas.center(), width: 240, height: 140 });
    execute([{ type: 'addConcept', concept, placement }]); session.select(placement.id);
    const edit = inspector.querySelector('details.studio-edit'); if (edit) edit.open = true;
    inspector.querySelector('input[name="title"]')?.focus(); inspector.querySelector('input[name="title"]')?.select();
  }
  function focusConcept(id) {
    const doc = session.getDocument();
    const candidates = doc.placements.filter(p => p.conceptId === id);
    const p = candidates.find(p => p.spaceId === session.getStatus().ui.spaceId) || candidates[0];
    if (p) { void jumpTo(id); return true; }
    const c = doc.concepts.find(c => c.id === id);
    if (!c) return false;
    inspectorKey = ''; inspector.replaceChildren(element('h2', { text: c.title }), element('p', { text: c.definition || 'Questo concetto non ha comparse sulla tela.' }),
      button('Mostra su questa tela', () => act(() => addExisting(id)), { disabled: readOnly }));
    return true;
  }
  function addExisting(id) {
    const placement = createPlacement(session.getStatus().ui.spaceId, id, { ...canvas.center(), width: 220, height: 110 });
    execute([{ type: 'addPlacement', placement }]); session.select(placement.id);
  }
  function showReuse() {
    inspectorKey = '';
    const doc = session.getDocument(), select = element('select', { 'aria-label': 'Concetto da riusare' });
    for (const c of doc.concepts) select.append(element('option', { value: c.id, text: c.title || 'Senza titolo' }));
    inspector.replaceChildren(element('h2', { text: 'Riusa un concetto' }), element('p', { class: 'muted', text: 'La nuova bolla condivide definizione e relazioni con le altre comparse.' }), select,
      button('Aggiungi alla tela', () => act(() => addExisting(select.value)), { class: 'primary', disabled: !doc.concepts.length }));
  }

  /** Relazioni verso concetti fuori dal livello: diventano portali sulla tela. */
  function portals(doc, projection) {
    const visible = new Set(projection.placements.map(p => p.conceptId));
    const concepts = new Map(doc.concepts.map(c => [c.id, c])), spaces = new Map(doc.spaces.map(s => [s.id, s]));
    return projection.externalRelations.map(r => {
      const outgoing = visible.has(r.sourceConceptId);
      const to = outgoing ? r.targetConceptId : r.sourceConceptId;
      const home = doc.placements.find(p => p.conceptId === to);
      return { from: outgoing ? r.sourceConceptId : r.targetConceptId, to, outgoing, label: r.label || r.predicate,
        title: concepts.get(to)?.title || 'Senza titolo', where: home ? `livello «${spaces.get(home.spaceId)?.title || 'principale'}»` : 'senza bolla' };
    });
  }
  function renderCanvas() {
    const doc = session.getDocument(), status = session.getStatus();
    const reset = lastDocument !== doc.id;
    lastDocument = doc.id;
    const projection = projectSpace(doc, status.ui.spaceId);
    canvas.draw({ ...projection, portals: portals(doc, projection) }, status.ui.selectedPlacementId, reset, transition);
    const current = spaceBreadcrumb(doc, status.ui.spaceId);
    back.disabled = current.length < 2;
    crumbs.replaceChildren();
    current.forEach((s, i) => {
      if (i) crumbs.append(element('span', { text: '›', 'aria-hidden': 'true' }));
      crumbs.append(button(s.title || 'Senza titolo', () => act(() => goTo(s.id)), i === current.length - 1 ? { 'aria-current': 'page' } : {}));
    });
    if (lastSpace !== status.ui.spaceId) { lastSpace = status.ui.spaceId; inspectorKey = ''; }
  }
  function renderOutline() {
    const doc = session.getDocument(); results.replaceChildren();
    if (searchTerm.trim()) {
      const matches = searchConcepts(doc, searchTerm);
      if (!matches.length) results.append(element('p', { class: 'muted', text: 'Nessun concetto trovato.' }));
      for (const match of matches) results.append(button(`${match.concept.title || 'Senza titolo'}${match.placements.length ? '' : ' · senza bolla'}`, () => act(() => focusConcept(match.concept.id))));
      return;
    }
    const bySpace = new Map(), byConcept = new Map(doc.concepts.map(c => [c.id, c])), owners = new Map(doc.spaces.map(s => [s.id, s.ownerConceptId]));
    for (const p of doc.placements) { if (!bySpace.has(p.spaceId)) bySpace.set(p.spaceId, []); bySpace.get(p.spaceId).push(p); }
    const stack = (bySpace.get(doc.rootSpaceId) || []).slice().reverse().map(p => ({ p, depth: 0 }));
    while (stack.length) {
      const { p, depth } = stack.pop(), c = byConcept.get(p.conceptId);
      if (owners.get(p.spaceId) === p.conceptId) continue; // il centro di un approfondimento è già la riga padre
      const row = button(`${p.childSpaceId ? '▸ ' : '· '}${c.title || 'Senza titolo'}`, () => act(() => jumpToPlacement(p)),
        { title: c.title || 'Senza titolo', class: p.id === session.getStatus().ui.selectedPlacementId ? 'active' : '' });
      row.style.paddingLeft = `${10 + Math.min(depth, 6) * 14}px`;
      results.append(row);
      for (const child of (bySpace.get(p.childSpaceId) || []).slice().reverse()) stack.push({ p: child, depth: depth + 1 });
    }
    const visible = new Set(doc.placements.map(p => p.conceptId));
    const orphans = doc.concepts.filter(c => !visible.has(c.id));
    if (orphans.length) results.append(element('p', { class: 'muted', text: 'Concetti senza bolla' }));
    for (const c of orphans) results.append(button(c.title || 'Senza titolo', () => act(() => focusConcept(c.id))));
  }
  async function jumpToPlacement(p) {
    if (p.spaceId !== session.getStatus().ui.spaceId) await goTo(p.spaceId);
    if (session.getStatus().ui.spaceId === p.spaceId) session.select(p.id);
  }
  search.addEventListener('input', () => { searchTerm = search.value; renderOutline(); });

  /** Testo con i titoli degli altri concetti trasformati in collegamenti. */
  function linked(text, doc, selfId) {
    const titles = doc.concepts.filter(c => c.id !== selfId && c.title.trim().length >= 3)
      .sort((a, b) => b.title.length - a.title.length).slice(0, 300);
    if (!titles.length || !text) return [text];
    const byTitle = new Map(titles.map(c => [c.title.toLocaleLowerCase('it'), c.id]));
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${titles.map(c => escapeRegExp(c.title)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    const nodes = []; let last = 0;
    for (const match of text.matchAll(pattern)) {
      const id = byTitle.get(match[0].toLocaleLowerCase('it'));
      if (!id) continue;
      nodes.push(text.slice(last, match.index), button(match[0], () => act(() => jumpTo(id)), { class: 'studio-link', title: 'Vai al concetto' }));
      last = match.index + match[0].length;
    }
    nodes.push(text.slice(last));
    return nodes;
  }
  function renderInspector(force = false) {
    const { doc, p, c } = selected(), key = `${doc.id}:${p?.id || ''}`;
    if (key === inspectorKey && !force) return;
    inspectorKey = key; inspector.replaceChildren();
    if (!p) {
      const s = space(), owner = doc.concepts.find(c => c.id === s?.ownerConceptId);
      inspector.append(element('h2', { text: owner ? owner.title : 'Scheda concetto' }));
      if (owner?.definition) inspector.append(element('p', {}, ...linked(owner.definition, doc, owner.id)));
      inspector.append(element('p', { class: 'muted', text: 'Seleziona una bolla per leggerne la scheda. Doppio clic (o Invio) per entrarci e vedere il dettaglio; Esc o «↑ Esci» per tornare su.' }),
        element('p', { class: 'muted', text: 'Le frecce sono relazioni; le pillole tratteggiate portano a concetti che stanno in altri livelli.' }));
      return;
    }
    const isHub = p.conceptId === space()?.ownerConceptId;
    const head = element('div', { class: 'studio-inspector-head' }, element('span', { class: 'studio-kind', text: kindLabels[c.kind] }),
      button('×', () => session.select(null), { 'aria-label': 'Chiudi scheda' }));
    inspector.append(head, element('h2', { text: c.title || 'Senza titolo' }));
    if (c.definition) inspector.append(element('p', { class: 'studio-definition' }, ...linked(c.definition, doc, c.id)));
    if (c.explanation) inspector.append(element('p', { class: 'studio-explanation' }, ...linked(c.explanation, doc, c.id)));
    if (c.examples.length) {
      inspector.append(element('h3', { text: 'Esempi' }));
      inspector.append(element('ul', { class: 'studio-examples' }, ...c.examples.map(e => element('li', {}, ...linked(e, doc, c.id)))));
    }
    const nav = element('div', { class: 'studio-actions' });
    nav.append(isHub ? button('↑ Esci da questo livello', () => act(() => goUp()), { class: 'primary' })
      : button(p.childSpaceId ? 'Entra nel dettaglio →' : 'Approfondisci →', () => act(() => deepen(p.id)), { class: 'primary', disabled: readOnly && !p.childSpaceId }));
    if (adapters.requestQuiz) nav.append(button('Crea carte di ripasso', () => request('quizRequested', 'requestQuiz', { conceptIds: [c.id], concepts: [{ title: c.title, definition: c.definition }], includeDescendants: false })));
    if (adapters.askTutor) nav.append(button('Chiedi al tutor', () => request('tutorRequested', 'askTutor', { conceptIds: [c.id], concepts: [{ title: c.title, definition: c.definition }] })));
    inspector.append(nav);

    const relations = doc.relations.filter(r => r.sourceConceptId === c.id || r.targetConceptId === c.id);
    if (relations.length) {
      inspector.append(element('h3', { text: 'Collegamenti' }));
      const list = element('ul', { class: 'studio-links' });
      for (const r of relations) {
        const outgoing = r.sourceConceptId === c.id, other = doc.concepts.find(item => item.id === (outgoing ? r.targetConceptId : r.sourceConceptId));
        const here = doc.placements.some(q => q.conceptId === other.id && q.spaceId === p.spaceId);
        list.append(element('li', {}, element('span', { class: 'muted', text: `${outgoing ? '' : '← '}${r.label || r.predicate}${outgoing ? ' →' : ''} ` }),
          button(other.title || 'Senza titolo', () => act(() => jumpTo(other.id)), { class: 'studio-link', title: here ? 'In questo livello' : 'In un altro livello' }),
          here ? null : element('span', { class: 'muted', text: ' ↗' })));
      }
      inspector.append(list);
    }
    if (c.sourceRefs.length) {
      inspector.append(element('h3', { text: 'Dal materiale' }));
      for (const ref of c.sourceRefs) inspector.append(sourceButton(ref));
    }
    const count = doc.placements.filter(other => other.conceptId === c.id).length;
    if (count > 1) inspector.append(element('p', { class: 'muted', text: `Concetto presente in ${count} bolle: la scheda è condivisa.` }));
    if (c.provenance?.origin === 'llm' && c.reviewStatus !== 'verified') inspector.append(element('p', { class: 'muted', text: '✦ Generato dal materiale, da verificare.' }));
    if (!readOnly) inspector.append(editSection(doc, p, c));
  }
  function editSection(doc, p, c) {
    const edit = element('details', { class: 'studio-edit' }, element('summary', { text: 'Modifica scheda e relazioni' }));
    const form = element('form', { class: 'studio-concept-form' });
    function textInput(name, value, label, multiline = false, max = 50000) {
      const input = element(multiline ? 'textarea' : 'input', { name, maxlength: max, ...(multiline ? { rows: 3 } : {}) });
      input.value = value;
      form.append(field(label, input)); return input;
    }
    const title = textInput('title', c.title, 'Titolo', false, 500);
    const kind = element('select', { name: 'kind' });
    CONCEPT_KINDS.forEach(k => kind.append(element('option', { value: k, text: kindLabels[k] }))); kind.value = c.kind;
    form.append(field('Tipo', kind));
    const definition = textInput('definition', c.definition, 'Definizione', true);
    const explanation = textInput('explanation', c.explanation, 'Spiegazione', true);
    const examples = textInput('examples', c.examples.join('\n'), 'Esempi · uno per riga', true);
    const tags = textInput('tags', c.tags.join(', '), 'Tag · separati da virgole');
    const review = element('select', { name: 'reviewStatus' }, element('option', { value: 'unverified', text: 'Da verificare' }), element('option', { value: 'verified', text: 'Verificato' }));
    review.value = c.reviewStatus; form.append(field('Verifica del contenuto', review));
    const commit = () => execute([{ type: 'updateConcept', id: c.id, changes: { title: title.value.trim() || 'Senza titolo', kind: kind.value,
      definition: definition.value, explanation: explanation.value, examples: examples.value.split('\n').map(s => s.trim()).filter(Boolean),
      tags: tags.value.split(',').map(s => s.trim()).filter(Boolean), reviewStatus: review.value } }]);
    // Salvataggio al cambio di campo; il DOM del form resta stabile durante la scrittura.
    form.addEventListener('change', () => act(commit));
    form.addEventListener('submit', event => { event.preventDefault(); act(commit); });
    form.append(element('button', { type: 'submit', text: 'Applica', class: 'primary' }));
    edit.append(form);

    const relations = doc.relations.filter(r => r.sourceConceptId === c.id || r.targetConceptId === c.id);
    if (relations.length) edit.append(element('h3', { text: 'Relazioni' }));
    for (const r of relations) {
      const source = doc.concepts.find(item => item.id === r.sourceConceptId), target = doc.concepts.find(item => item.id === r.targetConceptId);
      const block = element('div', { class: 'studio-relation' });
      block.append(element('p', { text: `${source.title} ${r.directed ? '→' : '↔'} ${target.title}` }));
      const label = element('input', { 'aria-label': 'Etichetta relazione', maxlength: 500 }); label.value = r.label;
      label.addEventListener('change', () => act(() => execute([{ type: 'updateRelation', id: r.id, changes: { label: label.value } }])));
      const direction = element('input', { type: 'checkbox' }); direction.checked = r.directed;
      direction.addEventListener('change', () => act(() => execute([{ type: 'updateRelation', id: r.id, changes: { directed: direction.checked } }])));
      block.append(label, field('Direzionale', direction),
        button('Rimuovi relazione', () => act(() => execute([{ type: 'removeRelation', id: r.id }])), { class: 'danger' }));
      edit.append(block);
    }
    const linkForm = element('form', { class: 'studio-link-form' });
    const target = element('select', { 'aria-label': 'Concetto da collegare' });
    doc.concepts.filter(other => other.id !== c.id).forEach(other => target.append(element('option', { value: other.id, text: other.title || 'Senza titolo' })));
    const predicate = element('input', { placeholder: 'es. richiede', 'aria-label': 'Verbo della relazione', required: true, maxlength: 120 });
    linkForm.append(field('Collega a (anche in altri livelli)', target), predicate, element('button', { type: 'submit', text: 'Crea relazione →', disabled: !target.options.length }));
    linkForm.addEventListener('submit', event => { event.preventDefault(); act(() => {
      execute([{ type: 'addRelation', relation: createRelation(c.id, target.value, predicate.value.trim() || 'è collegato a') }]);
    }); });
    edit.append(linkForm);

    const geometry = element('details', {}, element('summary', { text: 'Posizione e dimensioni' }));
    const geometryForm = element('form', { class: 'studio-geometry' });
    const geometryInputs = {};
    for (const [name, label, min, max] of [['x', 'X', -1000000, 1000000], ['y', 'Y', -1000000, 1000000], ['width', 'Larghezza', 80, 4000], ['height', 'Altezza', 40, 4000]]) {
      const input = element('input', { type: 'number', name, min, max, step: 1, required: true }); input.value = p[name]; geometryInputs[name] = input;
      geometryForm.append(field(label, input));
    }
    geometryForm.append(element('button', { type: 'submit', text: 'Sposta / ridimensiona' }));
    geometryForm.addEventListener('submit', event => { event.preventDefault(); act(() => {
      execute([{ type: 'updatePlacement', id: p.id, changes: Object.fromEntries(Object.entries(geometryInputs).map(([k, input]) => [k, Number(input.value)])) }]);
    }); });
    geometry.append(geometryForm); edit.append(geometry);
    edit.append(button('Duplica bolla', () => act(() => execute(duplicatePlacementCommands(session.getDocument(), p.id))), { class: 'wide' }),
      button('Rimuovi bolla', () => confirmAction('Rimuovere questa bolla e i suoi approfondimenti? I concetti e le relazioni saranno conservati.', () => execute([{ type: 'removePlacement', id: p.id }])), { class: 'wide danger' }),
      button('Elimina concetto ovunque', () => confirmAction('Eliminare il concetto, tutte le sue bolle e le sue relazioni? Puoi annullare questa operazione.', () => execute([{ type: 'deleteConcept', id: c.id }])), { class: 'wide danger subtle' }));
    return edit;
  }
  function confirmAction(text, action) {
    inspectorKey = '';
    inspector.replaceChildren(element('h2', { text: 'Conferma rimozione' }), element('p', { text }),
      button('Conferma', () => act(action), { class: 'danger' }), button('Annulla', () => renderInspector(true)));
  }
  function sourceButton(ref) {
    const label = ref.excerpt || `documento ${ref.documentId}`;
    const time = ref.start != null ? ` · ▶ ${Math.floor(ref.start / 60)}:${String(ref.start % 60).padStart(2, '0')}` : '';
    return button(`${label}${time}`, () => request('sourceRequested', 'resolveSource', { sourceRef: ref }), { class: 'wide studio-source', disabled: !adapters.resolveSource, title: label });
  }
  async function request(type, adapter, payload) {
    const status = session.getStatus();
    const detail = { mapId: status.documentId, revision: status.revision, changeVersion: status.changeVersion, ...payload };
    emit(type, detail);
    try {
      const result = await adapters[adapter]?.(adapter === 'resolveSource' ? payload.sourceRef : detail);
      if (typeof result === 'string' && !destroyed) message(result);
    } catch (error) { if (!destroyed) message(error.message, true); }
  }
  function render(force = false) {
    const status = session.getStatus();
    if (document.activeElement !== titleInput) titleInput.value = session.getDocument().title;
    undo.disabled = readOnly || !status.canUndo; redo.disabled = readOnly || !status.canRedo;
    grow.disabled = readOnly || !adapters.expandConcept || status.ui.spaceId === session.getDocument().rootSpaceId;
    renderCanvas(); renderOutline(); renderInspector(force);
  }
  const unsubscribe = session.subscribe(event => {
    if (destroyed) return;
    // Aggiornare il form solo per modifiche esterne ai suoi campi (undo, relazioni,
    // caricamento). Il change corrente non deve distruggere il campo attivo.
    const insideForm = inspector.contains(document.activeElement) && document.activeElement?.closest('.studio-edit');
    const wasOpen = inspector.querySelector('details.studio-edit')?.open;
    render(event.type === 'documentChanged' && !insideForm);
    if (wasOpen) { const edit = inspector.querySelector('details.studio-edit'); if (edit) edit.open = true; }
    if (event.type === 'documentChanged') emit('documentChanged', { document: session.getDocument(), status: session.getStatus() });
    else if (event.type === 'selectionChanged') {
      const { p, c } = selected(); emit('selectionChanged', { conceptId: c?.id ?? null, placementId: p?.id ?? null, spaceId: event.ui.spaceId });
    } else emit(event.type, { status: session.getStatus() });
  });
  const controller = new AbortController();
  root.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select') || event.target.isContentEditable) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); if (!readOnly) act(() => event.shiftKey ? session.redo() : session.undo());
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save().catch(() => {}); }
    else if (event.key === 'Escape') {
      if (session.getStatus().ui.selectedPlacementId) session.select(null); else act(() => goUp());
    } else if (event.key === 'Delete' && session.getStatus().ui.selectedPlacementId && !readOnly) {
      const id = session.getStatus().ui.selectedPlacementId;
      confirmAction('Rimuovere la bolla e i suoi approfondimenti, conservando i concetti?', () => execute([{ type: 'removePlacement', id }]));
    }
  }, { signal: controller.signal });
  async function save() {
    if (destroyed) throw new Error('Editor chiuso');
    if (!adapters.saveDocument) throw new Error('Salvataggio non configurato');
    try { return await session.save(adapters); }
    catch (error) { if (!destroyed) message(`Salvataggio non riuscito: ${error.message}`, true); throw error; }
  }
  render();
  return {
    getDocument: session.getDocument, getStatus: session.getStatus,
    loadDocument(doc) { session.loadDocument(doc); message(''); },
    applyCommands(commands, guards) { if (readOnly) throw new Error('Mappa in sola lettura'); return session.execute(commands, guards); },
    applyProposal(proposal, guards) {
      if (readOnly) throw new Error('Mappa in sola lettura');
      if (!guards || guards.expectedDocumentId === undefined || guards.expectedRevision === undefined || guards.expectedChangeVersion === undefined)
        throw new Error('La proposta richiede ID documento, revisione e versione locale attesi');
      return session.execute(proposal.commands, guards);
    },
    focusConcept, save, exportSvg: () => canvas.serialize(),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { destroyed = true; controller.abort(); unsubscribe(); session.destroy(); canvas.destroy(); listeners.clear(); root.remove(); },
  };
}
