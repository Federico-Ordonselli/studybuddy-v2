/* Geometria pura: nessuna conoscenza di DOM, materia o persistenza. */
export function bounds(placements) {
  if (!placements.length) return { x: 0, y: 0, width: 900, height: 600 };
  const x = Math.min(...placements.map(p => p.x)) - 70;
  const y = Math.min(...placements.map(p => p.y)) - 70;
  return { x, y, width: Math.max(360, Math.max(...placements.map(p => p.x + p.width)) - x + 70),
    height: Math.max(260, Math.max(...placements.map(p => p.y + p.height)) - y + 70) };
}
function boundary(p, dx, dy) {
  const factor = Math.min(dx ? p.width / 2 / Math.abs(dx) : Infinity, dy ? p.height / 2 / Math.abs(dy) : Infinity);
  return { x: p.x + p.width / 2 + dx * factor, y: p.y + p.height / 2 + dy * factor };
}
export function edgePoints(source, target) {
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  if (!dx && !dy) return null;
  return { start: boundary(source, dx, dy), end: boundary(target, -dx, -dy) };
}
export function layoutCommands(placements) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(placements.length)));
  const width = Math.max(240, ...placements.map(p => p.width)) + 110;
  const height = Math.max(140, ...placements.map(p => p.height)) + 90;
  return placements.map((p, i) => ({ type: 'updatePlacement', id: p.id,
    changes: { x: 80 + (i % columns) * width, y: 100 + Math.floor(i / columns) * height } }));
}
export function wrapText(text, max = 28, lines = 3) {
  const words = text.replace(/\s+/g, ' ').trim().split(' '), result = [];
  let line = '';
  for (const word of words) {
    // Le parole molto lunghe vengono spezzate per restare nella bolla.
    for (let i = 0; i < word.length; i += max) {
      const part = word.slice(i, i + max);
      if (line && line.length + part.length + 1 > max) { result.push(line); line = ''; }
      line += (line ? ' ' : '') + part;
    }
  }
  if (line) result.push(line);
  if (result.length > lines) return [...result.slice(0, lines - 1), result[lines - 1].slice(0, max - 1) + '…'];
  return result;
}
/* Disposizione a raggiera: l'hub (se c'è) al centro, gli altri in cerchio.
   Il raggio cresce col numero di bolle perché non si sovrappongano. */
export function radialPositions(count, { hub = true, width = 220, height = 110 } = {}) {
  const ring = hub ? count - 1 : count;
  const radius = Math.max(420, ring * (width + 110) / (2 * Math.PI));
  const result = [];
  if (hub && count) result.push({ x: -width / 2, y: -height / 2 });
  for (let i = 0; i < ring; i++) {
    const angle = 2 * Math.PI * i / Math.max(1, ring) - Math.PI / 2;
    result.push({ x: Math.round(radius * Math.cos(angle) - width / 2), y: Math.round(radius * 0.78 * Math.sin(angle) - height / 2) });
  }
  return result;
}
