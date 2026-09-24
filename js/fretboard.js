// Fretboard chart as SVG: the note at every fret of a tuning, with an optional
// root and scale highlighted. Pure function, rendered by the tools page.

import { noteName, noteLabel, fretboardNotes, pitchClass, inScale } from './theory.js';
import { escapeXml } from './util.js';

const GEO = { padL: 48, padR: 14, top: 24, gap: 30, bottom: 40, boardW: 860, r: 11 };
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

/** x offsets of the nut (0) and each fret wire, spaced like a real neck and scaled to `width`. */
export function fretPositions(frets, width) {
  const span = 1 - Math.pow(2, -frets / 12);
  return Array.from({ length: frets + 1 }, (_, n) => (width * (1 - Math.pow(2, -n / 12))) / span);
}

export function fretboardSVG({ tuning, frets = 15, flats = false, root = null, scale = null, label = '' } = {}) {
  const strings = tuning.length;
  const width = GEO.padL + GEO.boardW + GEO.padR;
  const height = GEO.top + GEO.gap * (strings - 1) + GEO.bottom;
  const xs = fretPositions(frets, GEO.boardW).map((x) => GEO.padL + x);
  const yFor = (s) => GEO.top + s * GEO.gap;
  const yTop = yFor(0) - GEO.gap / 2;
  const yBottom = yFor(strings - 1) + GEO.gap / 2;
  const out = [`<svg class="fretboard-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img"${label ? ` aria-label="${escapeXml(label)}"` : ""}>`];
  out.push(`<rect class="fb-board" x="${xs[0]}" y="${yTop}" width="${xs[frets] - xs[0]}" height="${yBottom - yTop}" rx="3"/>`);
  for (const fret of INLAYS) {
    if (fret > frets) continue;
    const cx = (xs[fret - 1] + xs[fret]) / 2;
    const mid = (yTop + yBottom) / 2;
    if (fret % 12 === 0) out.push(`<circle class="fb-inlay" cx="${cx}" cy="${mid - GEO.gap}" r="5"/><circle class="fb-inlay" cx="${cx}" cy="${mid + GEO.gap}" r="5"/>`);
    else out.push(`<circle class="fb-inlay" cx="${cx}" cy="${mid}" r="5"/>`);
  }
  for (let n = 0; n <= frets; n++) {
    out.push(`<line class="${n === 0 ? 'fb-nut' : 'fb-fret'}" x1="${xs[n]}" y1="${yTop}" x2="${xs[n]}" y2="${yBottom}"/>`);
    if (n > 0) out.push(`<text class="fb-num" x="${(xs[n - 1] + xs[n]) / 2}" y="${yBottom + 16}">${n}</text>`);
  }
  for (let s = 0; s < strings; s++) {
    out.push(`<line class="fb-string" x1="${xs[0]}" y1="${yFor(s)}" x2="${xs[frets]}" y2="${yFor(s)}" stroke-width="${(1 + s * 0.4).toFixed(1)}"/>`);
  }
  const rows = fretboardNotes(tuning, frets);
  for (const row of rows) {
    for (const note of row) {
      const cx = note.fret === 0 ? GEO.padL - 22 : (xs[note.fret - 1] + xs[note.fret]) / 2;
      const cy = yFor(note.string);
      const classes = ['fb-note'];
      if (root !== null && root !== undefined) {
        if (pitchClass(note.pc) === pitchClass(root)) classes.push('is-root');
        else if (inScale(note.pc, root, scale)) classes.push(scale ? 'in-scale' : '');
        else classes.push('off');
      }
      out.push(
        `<g class="${classes.filter(Boolean).join(' ')}" data-midi="${note.midi}" data-string="${note.string}" data-fret="${note.fret}" tabindex="0" role="button" aria-label="${noteLabel(note.midi, { flats })}">` +
          `<circle cx="${cx}" cy="${cy}" r="${GEO.r}"/><text x="${cx}" y="${cy + 3.5}">${noteName(note.midi, { flats })}</text></g>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('');
}
