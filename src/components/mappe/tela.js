import { bounds, edgePoints, wrapText } from '@/lib/mappe/geometria.js';
import { button, element } from './dom.js';
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

/* I token seguono il tema anche sulla tela; l'export li risolve in colori autonomi. */
const C = {
  bubble: 'var(--color-surface)', deep: 'var(--color-surface-2)', hub: 'var(--user)',
  stroke: 'var(--color-border-strong)', selected: 'var(--color-accent)',
  title: 'var(--color-fg)', text: 'var(--color-fg-muted)', edge: 'var(--color-fg-dim)',
  halo: 'var(--color-bg)', accent: 'var(--color-accent)', portal: 'var(--color-surface)',
};
const DOUBLE_TAP_MS = 380;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* Pointer capture rimane sullo SVG stabile, anche se una selezione ridisegna le
   bolle. Con la capture attiva click/dblclick arrivano allo SVG e non alla
   bolla: per questo tap e doppio tap si riconoscono qui, al pointerup, usando
   la bolla registrata al pointerdown. */
export function createCanvas(container, { select, enter, move, portal, readOnly = false }) {
  const id = `studio-arrow-${crypto.randomUUID()}`;
  const canvas = svg('svg', { class: 'studio-canvas', tabindex: '0', 'font-family': 'system-ui, sans-serif', 'aria-label': 'Tela dei concetti: doppio clic su una bolla per entrarci, trascina lo sfondo per spostarti, rotella per lo zoom' });
  const controls = element('div', { class: 'studio-zoom', 'aria-label': 'Navigazione della tela' });
  const zoomLabel = element('span', { text: '100%' });
  const busyBox = element('div', { class: 'studio-busy', hidden: true });
  controls.append(button('−', () => zoom(1.2), { 'aria-label': 'Riduci zoom' }), zoomLabel,
    button('+', () => zoom(1 / 1.2), { 'aria-label': 'Aumenta zoom' }), button('Adatta', () => animateView(fitView(), 300)));
  container.append(canvas, controls, busyBox);
  let projection, selected, view = { x: 0, y: 0, width: 900, height: 600 }, gesture = null, destroyed = false, signature = '';
  let frame = 0, settle = null, lastTap = null;
  // Ferma l'animazione in corso risolvendone comunque la promise.
  function stop() { cancelAnimationFrame(frame); frame = 0; settle?.(); settle = null; }
  const controller = new AbortController();
  const on = (type, fn, options = {}) => canvas.addEventListener(type, fn, { ...options, signal: controller.signal });
  const aspect = () => (canvas.clientWidth || 900) / (canvas.clientHeight || 600);
  function setView() {
    canvas.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    zoomLabel.textContent = `${Math.round((canvas.clientWidth || 900) / view.width * 100)}%`;
  }
  function point(event) {
    const matrix = canvas.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  }
  function zoom(factor, anchor = { x: view.x + view.width / 2, y: view.y + view.height / 2 }) {
    stop();
    const width = Math.max(180, Math.min(2000000, view.width * factor));
    const actual = width / view.width;
    view = { x: anchor.x - (anchor.x - view.x) * actual, y: anchor.y - (anchor.y - view.y) * actual,
      width, height: view.height * actual };
    setView();
  }
  /** Inquadratura di un rettangolo con il rapporto della tela. */
  function framing(box, scale = 1) {
    const width = Math.max(box.width, box.height * aspect()) * scale, height = width / aspect();
    return { x: box.x + box.width / 2 - width / 2, y: box.y + box.height / 2 - height / 2, width, height };
  }
  const fitView = () => framing(bounds(projection?.placements ?? []));
  function fit() { stop(); if (projection) { view = fitView(); setView(); } }
  function animateView(target, ms = 420) {
    stop();
    if (reducedMotion() || destroyed) { view = target; setView(); return Promise.resolve(); }
    const from = { ...view }, start = performance.now();
    return new Promise(resolve => {
      settle = resolve;
      const step = now => {
        if (destroyed) return stop();
        const k = ease(Math.min(1, (now - start) / ms));
        view = Object.fromEntries(Object.keys(from).map(key => [key, from[key] + (target[key] - from[key]) * k]));
        setView();
        if (k < 1) frame = requestAnimationFrame(step); else stop();
      };
      frame = requestAnimationFrame(step);
    });
  }
  /** Ingresso "fisico": la bolla riempie lo schermo mentre il resto si dissolve. */
  async function zoomInto(placementId) {
    const p = projection?.placements.find(p => p.id === placementId);
    if (!p) return;
    canvas.classList.add('studio-diving');
    canvas.querySelector(`[data-placement="${CSS.escape(placementId)}"]`)?.classList.add('studio-target');
    await animateView(framing({ x: p.x, y: p.y, width: p.width, height: p.height }, 0.9), 480);
  }
  /** Uscita: il livello corrente si allontana e svanisce. */
  async function zoomAway() {
    canvas.classList.add('studio-leaving');
    await animateView(framing(view, 3), 380);
  }
  async function fade() {
    canvas.classList.add('studio-leaving');
    await new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : 160));
  }
  function arrive(start, ms) {
    view = start; setView();
    canvas.classList.remove('studio-diving', 'studio-leaving');
    canvas.classList.add('studio-arriving');
    requestAnimationFrame(() => canvas.classList.remove('studio-arriving'));
    return animateView(fitView(), ms);
  }

  function draw(next, selectedId, reset = false, transition = null) {
    const spaceChanged = projection?.space.id !== next.space.id;
    const nextSignature = JSON.stringify(next);
    // La selezione non sostituisce i bersagli pointer: le bolle restano gli stessi
    // nodi anche dopo il pointerdown, così il secondo tap trova la stessa bolla.
    if (!reset && nextSignature === signature) {
      projection = next; selected = selectedId;
      const placements = new Map(next.placements.map(p => [p.id, p]));
      for (const group of canvas.querySelectorAll('[data-placement]')) {
        const p = placements.get(group.dataset.placement), active = p.id === selectedId;
        group.classList.toggle('selected', active);
        group.setAttribute('aria-pressed', String(active));
        group.setAttribute('transform', `translate(${p.x} ${p.y})`);
        const rect = group.querySelector('rect');
        rect.setAttribute('stroke-width', active ? '3' : '1.5');
        rect.setAttribute('stroke', active ? C.selected : rect.dataset.stroke);
      }
      if (!frame) setView(); return;
    }
    signature = nextSignature;
    projection = next; selected = selectedId;
    canvas.replaceChildren();
    const defs = svg('defs'), marker = svg('marker', { id, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' });
    marker.append(svg('path', { d: 'M0 0 L8 4 L0 8 Z', fill: C.edge })); defs.append(marker); canvas.append(defs);
    const concepts = new Map(next.concepts.map(c => [c.id, c]));
    const hubConcept = next.space.ownerConceptId;
    for (const r of next.relations) {
      const sources = next.placements.filter(p => p.conceptId === r.sourceConceptId);
      const targets = next.placements.filter(p => p.conceptId === r.targetConceptId);
      // Una linea per relazione, fra le due comparse più vicine.
      let pair, distance = Infinity;
      for (const a of sources) for (const b of targets) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (a.id !== b.id && d < distance) { distance = d; pair = [a, b]; }
      }
      if (!pair) continue;
      const points = edgePoints(...pair);
      if (!points) continue;
      const { start, end } = points;
      canvas.append(svg('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: C.edge, 'stroke-width': 1.8,
        ...(r.directed ? { 'marker-end': `url(#${id})` } : { 'stroke-dasharray': '6 5' }) }));
      canvas.append(svg('text', { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 8, class: 'studio-edge-label',
        'text-anchor': 'middle', fill: C.text, 'font-size': 13, 'paint-order': 'stroke', stroke: C.halo, 'stroke-width': 5 }, r.label || r.predicate));
    }
    for (const p of next.placements) {
      const c = concepts.get(p.conceptId), hub = p.conceptId === hubConcept, active = p.id === selected;
      const fill = hub ? C.hub : p.childSpaceId ? C.deep : C.bubble, stroke = hub ? C.accent : C.stroke;
      const group = svg('g', { 'data-placement': p.id, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button',
        'aria-label': `${c.title}. ${hub ? 'Concetto di questo livello: doppio clic per uscire.' : p.childSpaceId ? 'Contiene un approfondimento: doppio clic per entrare.' : 'Doppio clic per approfondire.'}`,
        'aria-pressed': active, class: `studio-bubble${active ? ' selected' : ''}${hub ? ' hub' : ''}` });
      const rect = svg('rect', { width: p.width, height: p.height, rx: 16, fill, stroke: active ? C.selected : stroke, 'stroke-width': active ? 3 : 1.5 });
      rect.dataset.stroke = stroke;
      group.append(svg('title', {}, `${c.title}\n${c.definition}`), rect);
      const charWidth = Math.max(6, Math.floor((p.width - 36) / 9));
      const titleLines = wrapText(c.title || 'Senza titolo', charWidth, Math.max(1, Math.min(2, Math.floor((p.height - 16) / 24))));
      titleLines.forEach((line, i) => group.append(svg('text', { x: 18, y: 29 + i * 23, 'font-size': 17, 'font-weight': 650, fill: C.title }, line)));
      const available = Math.max(0, Math.floor((p.height - 23 * titleLines.length - 26) / 18));
      if (available) wrapText(c.definition, Math.max(8, Math.floor((p.width - 36) / 7)), Math.min(3, available)).forEach((line, i) =>
        group.append(svg('text', { x: 18, y: 40 + titleLines.length * 23 + i * 18, 'font-size': 13, fill: C.text }, line)));
      const corner = hub ? '↑ esci' : p.childSpaceId ? '⤵ entra' : '';
      if (corner) group.append(svg('text', { x: p.width - 14, y: p.height - 11, 'text-anchor': 'end', 'font-size': 12, fill: C.accent }, corner));
      canvas.append(group);
    }
    drawPortals(next);
    if (!next.placements.length) {
      canvas.append(svg('text', { x: 450, y: 300, 'text-anchor': 'middle', 'font-size': 18, fill: C.text, class: 'studio-empty' }, 'Livello vuoto: aggiungi un concetto o generalo dal materiale'));
    }
    if (!spaceChanged && !reset) { if (!frame) setView(); return; }
    // Il nuovo livello compare "da dentro" (piccolo → pieno) o "da fuori"
    // (zoomato sulla bolla da cui si esce → panoramica).
    if (transition?.kind === 'in') arrive(framing(bounds(next.placements), 3.2), 480);
    else if (transition?.kind === 'out') {
      const via = next.placements.find(p => p.id === transition.placementId);
      arrive(via ? framing({ x: via.x, y: via.y, width: via.width, height: via.height }, 0.9) : framing(bounds(next.placements), 0.6), 480);
    } else if (transition?.kind === 'jump') arrive(fitView(), 1);
    else fit();
  }
  /* Portali: relazioni verso concetti che stanno in altri livelli. Pillole
     tratteggiate sotto la bolla, cliccabili come un collegamento ipertestuale. */
  function drawPortals(next) {
    const byConcept = new Map();
    for (const portalInfo of next.portals ?? []) {
      if (!byConcept.has(portalInfo.from)) byConcept.set(portalInfo.from, []);
      byConcept.get(portalInfo.from).push(portalInfo);
    }
    for (const [conceptId, list] of byConcept) {
      const p = next.placements.find(p => p.conceptId === conceptId);
      if (!p) continue;
      const shown = list.slice(0, 3);
      shown.forEach((info, i) => {
        const text = wrapText(`${info.outgoing ? '→' : '←'} ${info.label}: ${info.title}`, 34, 1)[0];
        const width = Math.min(p.width + 60, 22 + text.length * 6.8);
        const pill = svg('g', { 'data-portal': info.to, transform: `translate(${p.x + 8} ${p.y + p.height + 8 + i * 26})`, class: 'studio-portal', role: 'link', tabindex: 0,
          'aria-label': `Vai a ${info.title}` });
        pill.append(svg('title', {}, `Vai a «${info.title}» (${info.where})`),
          svg('rect', { width, height: 21, rx: 10.5, fill: C.portal, stroke: C.accent, 'stroke-width': 1, 'stroke-dasharray': '3 3' }),
          svg('text', { x: 11, y: 14.5, 'font-size': 11.5, fill: C.accent }, text));
        canvas.append(pill);
      });
      if (list.length > shown.length) canvas.append(svg('text', { x: p.x + 14, y: p.y + p.height + 8 + shown.length * 26 + 13, 'font-size': 11.5, fill: C.text },
        `+${list.length - shown.length} collegamenti nella scheda`));
    }
  }
  on('pointerdown', event => {
    if (event.button !== 0 || gesture) return;
    const group = event.target.closest('[data-placement]');
    const p = projection?.placements.find(p => p.id === group?.dataset.placement);
    gesture = { pointerId: event.pointerId, start: point(event), clientX: event.clientX, clientY: event.clientY, view: { ...view },
      placement: p && !readOnly ? { ...p } : null, clickedId: p?.id, portal: event.target.closest('[data-portal]')?.dataset.portal, moved: false };
    canvas.setPointerCapture(event.pointerId);
    if (p) select(p.id);
  });
  on('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture;
    if (Math.hypot(event.clientX - g.clientX, event.clientY - g.clientY) < 4 && !g.moved) return;
    g.moved = true; stop();
    const current = point(event), dx = current.x - g.start.x, dy = current.y - g.start.y;
    if (g.placement) {
      g.target = { x: Math.round(g.placement.x + dx), y: Math.round(g.placement.y + dy) };
      canvas.querySelector(`[data-placement="${CSS.escape(g.placement.id)}"]`)?.setAttribute('transform', `translate(${g.target.x} ${g.target.y})`);
    } else {
      // Coordinate iniziali stabili: il movimento non dipende dal viewBox aggiornato.
      const scale = g.view.width / (canvas.clientWidth || 900);
      view = { ...g.view, x: g.view.x - (event.clientX - g.clientX) * scale, y: g.view.y - (event.clientY - g.clientY) * scale };
      setView();
    }
  });
  on('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture; gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (g.target && g.placement) { lastTap = null; move(g.placement.id, g.target); return; }
    if (g.moved) { lastTap = null; return; }
    if (g.portal) { lastTap = null; portal(g.portal); return; }
    if (!g.clickedId) { lastTap = null; select(null); return; }
    const now = performance.now();
    if (lastTap?.id === g.clickedId && now - lastTap.time < DOUBLE_TAP_MS) { lastTap = null; enter(g.clickedId); }
    else lastTap = { id: g.clickedId, time: now };
  });
  on('pointercancel', () => { gesture = null; if (projection) draw(projection, selected, true); });
  on('wheel', event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.1 : 1 / 1.1, point(event)); }, { passive: false });
  on('keydown', event => {
    const p = event.target.closest('[data-placement]')?.dataset.placement;
    const link = event.target.closest('[data-portal]')?.dataset.portal;
    if (link && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); portal(link); }
    else if (p && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(p); if (event.key === 'Enter') enter(p); }
    else if (event.key === '+' || event.key === '=') zoom(1 / 1.2);
    else if (event.key === '-') zoom(1.2);
  });
  const resize = new ResizeObserver(() => { if (!destroyed && projection && !frame) fit(); }); resize.observe(container);
  return { draw, fit, zoomInto, zoomAway, fade,
    center: () => ({ x: view.x + view.width / 2 - 120, y: view.y + view.height / 2 - 70 }),
    busy(text) { busyBox.hidden = !text; busyBox.replaceChildren(...(text ? [element('span', { class: 'spin' }), element('span', { text })] : [])); },
    serialize() {
      const copy = canvas.cloneNode(true), box = bounds(projection.placements);
      copy.setAttribute('xmlns', NS); copy.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
      copy.setAttribute('width', box.width); copy.setAttribute('height', box.height);
      copy.insertBefore(svg('rect', { x: box.x, y: box.y, width: box.width, height: box.height, fill: C.halo }), copy.firstChild.nextSibling);
      const tokens = getComputedStyle(document.documentElement);
      for (const node of copy.querySelectorAll('[fill], [stroke], [data-stroke]')) {
        for (const attr of ['fill', 'stroke', 'data-stroke']) {
          const value = node.getAttribute(attr);
          const token = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
          if (token) node.setAttribute(attr, tokens.getPropertyValue(token).trim());
        }
      }
      return new XMLSerializer().serializeToString(copy);
    },
    destroy() { destroyed = true; stop(); controller.abort(); resize.disconnect(); canvas.remove(); controls.remove(); busyBox.remove(); } };
}
