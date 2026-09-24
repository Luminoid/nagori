// Chord and position diagrams as inline SVG.
//
// String indexing follows the tab data: string 0 is the highest-pitched
// string (high e on guitar, G on bass) and string n-1 the lowest. Diagrams
// draw low strings on the left, like a printed chord box.

import { escapeXml } from './util.js';

const GEO = { padL: 24, padR: 8, padT: 22, padB: 12, stringGap: 14, fretGap: 17, fretsShown: 5, dotR: 6.2 };

/** Parse "x35543" or "x 10 12 12 11 10" into a low-to-high array (null = muted). */
export function parseVoicing(text) {
  const parts = /[\s,]/.test(text.trim()) ? text.trim().split(/[\s,]+/) : text.trim().split('');
  return parts.map((p) => (p.toLowerCase() === 'x' ? null : parseInt(p, 10)));
}

/** Convert a low-to-high voicing into diagram notes keyed by tab string index. */
export function voicingToShape(frets, fingers, strings) {
  const notes = [];
  const opens = [];
  const mutes = [];
  frets.forEach((fret, i) => {
    const s = strings - 1 - i;
    if (fret === null || Number.isNaN(fret)) mutes.push(s);
    else if (fret === 0) opens.push(s);
    else notes.push({ s, f: fret, finger: fingers ? fingers[i] : null, played: true });
  });
  return { strings, notes, opens, mutes, barre: inferBarre(notes) };
}

/** A barre is one finger on two or more strings at the same fret (usually 1; a ring-finger barre in an A-form major too). */
export function inferBarre(notes) {
  let best = null;
  for (const finger of [1, 2, 3, 4]) {
    const group = notes.filter((n) => n.finger === finger);
    if (group.length < 2 || !group.every((n) => n.f === group[0].f)) continue;
    if (!best || group.length > best.group.length) best = { finger, group };
  }
  if (!best) return null;
  const { finger, group } = best;
  return { fret: group[0].f, from: Math.max(...group.map((n) => n.s)), to: Math.min(...group.map((n) => n.s)), finger };
}

export function baseFretFor(notes) {
  const frets = notes.map((n) => n.f).filter((f) => f > 0);
  if (!frets.length) return 1;
  const max = Math.max(...frets);
  if (max <= GEO.fretsShown) return 1;
  return Math.max(1, Math.min(...frets));
}

function rowsFor(notes, base) {
  const frets = notes.map((n) => n.f).filter((f) => f > 0);
  const max = frets.length ? Math.max(...frets) : base;
  return Math.max(GEO.fretsShown, max - base + 1);
}

/**
 * Render a diagram. shape = { strings, notes: [{ s, f, finger, played }], opens, mutes, barre }.
 * Unplayed chord tones (played === false) are drawn hollow so a card can say
 * "hold this shape, pick these strings".
 */
export function diagramSVG(shape, options = {}) {
  const strings = shape.strings || 6;
  const base = options.baseFret || baseFretFor(shape.notes);
  const rows = rowsFor(shape.notes, base);
  const width = GEO.padL + (strings - 1) * GEO.stringGap + GEO.padR;
  const height = GEO.padT + rows * GEO.fretGap + GEO.padB;
  const xFor = (s) => GEO.padL + (strings - 1 - s) * GEO.stringGap;
  const yFor = (fret) => GEO.padT + (fret - base + 0.5) * GEO.fretGap;
  const parts = [];
  parts.push(`<svg class="diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(options.label || 'chord diagram')}">`);
  // frets
  for (let i = 0; i <= rows; i++) {
    const y = GEO.padT + i * GEO.fretGap;
    const isNut = i === 0 && base === 1;
    parts.push(`<line class="${isNut ? 'nut' : 'grid-line'}" x1="${GEO.padL}" y1="${y}" x2="${GEO.padL + (strings - 1) * GEO.stringGap}" y2="${y}"/>`);
  }
  for (let s = 0; s < strings; s++) {
    parts.push(`<line class="grid-line" x1="${xFor(s)}" y1="${GEO.padT}" x2="${xFor(s)}" y2="${GEO.padT + rows * GEO.fretGap}"/>`);
  }
  if (base > 1) parts.push(`<text class="fret-label" x="${GEO.padL - 9}" y="${yFor(base) + 3}" text-anchor="end">${base}fr</text>`);
  for (const s of shape.opens || []) parts.push(`<text class="open" x="${xFor(s)}" y="${GEO.padT - 6}">○</text>`);
  for (const s of shape.mutes || []) parts.push(`<text class="mute" x="${xFor(s)}" y="${GEO.padT - 6}">×</text>`);
  if (shape.barre) {
    const y = yFor(shape.barre.fret);
    const x1 = xFor(shape.barre.from);
    const x2 = xFor(shape.barre.to);
    parts.push(`<rect class="barre" x="${Math.min(x1, x2) - GEO.dotR}" y="${y - 5}" width="${Math.abs(x2 - x1) + GEO.dotR * 2}" height="10" rx="5"/>`);
  }
  const sorted = [...shape.notes].sort((a, b) => (a.played === b.played ? 0 : a.played ? 1 : -1));
  for (const n of sorted) {
    if (n.f < base || n.f > base + rows - 1) continue;
    const x = xFor(n.s);
    const y = yFor(n.f);
    const cls = n.played === false ? 'dot repeat' : 'dot';
    parts.push(`<circle class="${cls}" cx="${x}" cy="${y}" r="${GEO.dotR}"${n.played === false ? ' opacity="0.45"' : ''}/>`);
    if (n.finger) parts.push(`<text class="dot-label" x="${x}" y="${y + 3}">${n.finger}</text>`);
  }
  if (options.stringLabels) {
    options.stringLabels.forEach((label, s) => {
      parts.push(`<text class="string-label" x="${xFor(s)}" y="${height - 2}">${escapeXml(label)}</text>`);
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Diagram for a library voicing such as { frets: "x35543", fingers: "x13421" }. */
export function voicingSVG(voicing, strings = 6, label = '', stringLabels = null) {
  const frets = parseVoicing(voicing.frets);
  const fingers = voicing.fingers ? parseVoicing(voicing.fingers).map((f) => (f === null || f === 0 ? null : f)) : null;
  return diagramSVG(voicingToShape(frets, fingers, strings), { label, stringLabels });
}
