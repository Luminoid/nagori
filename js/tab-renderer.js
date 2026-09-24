// Tablature layout and SVG rendering.
//
// layoutTrack() packs measures into systems (rows) for a given width and
// returns beat geometry; renderSystem() turns one system into SVG markup.
// Both are pure functions so they can be unit-tested in Node.

import { escapeXml, formatChord, durationValue, stringNames } from './util.js';

const TAB = {
  STRING_GAP: 13,
  TOP: 46,
  BOTTOM: 40,
  UNIT: 24,
  LABEL_W: 22,
  PAD_L: 12,
  PAD_R: 8,
  MIN_BEAT: 16,
  MIN_MEASURE: 48,
};

const Y = { marker: 12, chord: 28, ringLabel: 38, ring: 41 };

export function beatWidth(beat, unit = TAB.UNIT) {
  const dur = durationValue(beat);
  let w = unit * Math.pow(dur * 8, 0.55);
  if (beat.chord) w = Math.max(w, beat.chord.length * 7.5 + 8);
  return Math.max(TAB.MIN_BEAT, w);
}

function systemHeight(strings) {
  return TAB.TOP + (strings - 1) * TAB.STRING_GAP + TAB.BOTTOM;
}

/** Start fraction (0..1) of each beat inside its measure, by cumulative duration. */
export function beatFractions(measure) {
  const total = measure.beats.reduce((a, b) => a + durationValue(b), 0) || 1;
  let acc = 0;
  return measure.beats.map((b) => {
    const start = acc / total;
    acc += durationValue(b);
    return start;
  });
}

/** Index of the beat playing at fraction `frac` (0..1) of the measure. */
export function beatIndexAt(measure, frac) {
  const starts = beatFractions(measure);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= frac + 1e-9) idx = i;
  return idx;
}

export function layoutTrack(track, availableWidth, { unit = TAB.UNIT } = {}) {
  let currentSig = null;
  const measures = track.measures.map((m, i) => {
    const sig = m.sig && (!currentSig || m.sig[0] !== currentSig[0] || m.sig[1] !== currentSig[1]) ? m.sig : null;
    if (m.sig) currentSig = m.sig;
    let x = TAB.PAD_L + (sig ? 18 : 0);
    const beats = m.beats.map((b, j) => {
      const w = beatWidth(b, unit);
      const placed = { index: j, x, w, dur: durationValue(b) };
      x += w;
      return placed;
    });
    const natural = Math.max(x + TAB.PAD_R, TAB.MIN_MEASURE) + (m.marker ? 6 : 0);
    return { index: i, beats, natural, marker: m.marker || null, sig };
  });
  const inner = Math.max(120, availableWidth - TAB.LABEL_W);
  const rows = [];
  let row = [];
  let used = 0;
  for (const m of measures) {
    if (row.length && used + m.natural > inner) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(m);
    used += m.natural;
  }
  if (row.length) rows.push(row);
  const height = systemHeight(track.strings);
  return rows.map((ms, si) => {
    const total = ms.reduce((a, m) => a + m.natural, 0);
    let scale = inner / total;
    if (si === rows.length - 1 && scale > 1.6) scale = 1; // leave a short final row ragged
    let x = TAB.LABEL_W;
    const placed = ms.map((m) => {
      const width = m.natural * scale;
      const beats = m.beats.map((b) => ({ ...b, x: x + b.x * scale, w: b.w * scale }));
      const out = { ...m, x, width, beats };
      x += width;
      return out;
    });
    return { index: si, measures: placed, width: availableWidth, height, firstBar: placed[0].index, lastBar: placed[placed.length - 1].index };
  });
}

// --- Rendering ----------------------------------------------------------------

function fretText(note) {
  if (note.dead) return 'x';
  const text = String(note.f);
  return note.tie || note.ghost ? `(${text})` : text;
}

function fretClass(note) {
  if (note.dead) return 'fret dead';
  if (note.tie) return 'fret tied';
  if (note.ghost) return 'fret ghost';
  return 'fret';
}

function textWidth(text) {
  let w = 0;
  for (const ch of text) w += ch === '(' || ch === ')' ? 4 : 7.2;
  return w;
}

/** The next sounding note on a string anywhere later in the track (a hammer-on whose target sits in the next system); x is unknown. */
function nextNoteInTrack(track, barIndex, bi, string) {
  for (let m = barIndex; m < track.measures.length; m++) {
    const beats = track.measures[m].beats;
    for (let b = m === barIndex ? bi + 1 : 0; b < beats.length; b++) {
      if (beats[b].rest) continue;
      const note = beats[b].notes.find((n) => n.s === string && !n.dead);
      if (note) return { x: null, note, beat: beats[b] };
    }
  }
  return null;
}

/** Find the previous/next beat in the system holding a note on the same string. */
function neighborNote(system, mi, bi, string, direction) {
  const measures = system.measures;
  let m = mi;
  let b = bi + direction;
  while (m >= 0 && m < measures.length) {
    const beats = measures[m].beats;
    while (b >= 0 && b < beats.length) {
      const beat = measures[m].source.beats[b];
      if (!beat.rest) {
        const note = beat.notes.find((n) => n.s === string && !n.dead);
        if (note) return { x: beats[b].x, note, beat };
      }
      b += direction;
    }
    m += direction;
    if (m >= 0 && m < measures.length) b = direction > 0 ? 0 : measures[m].beats.length - 1;
  }
  return null;
}

/** "½", "full", "1½": how far a bend goes, in the tab's usual words. */
function bendLabel(amount) {
  const known = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: 'full', 1.25: '1¼', 1.5: '1½', 2: '2' };
  return known[amount] || String(amount);
}

function restGlyph(type, x, mid) {
  switch (type) {
    case 1:
      return `<rect class="rest" x="${x - 4}" y="${mid - 5}" width="8" height="3"/>`;
    case 2:
      return `<rect class="rest" x="${x - 4}" y="${mid + 1}" width="8" height="3"/>`;
    case 4:
      return `<path class="rest" d="M${x - 2} ${mid - 8} l4 4 l-4 4 l4 4" fill="none" stroke-width="1.6"/>`;
    default: {
      const flags = Math.max(1, Math.round(Math.log2(type)) - 2); // 8th 1, 16th 2, 32nd 3, 64th 4
      let out = `<line class="rest" x1="${x + 2}" y1="${mid - 4}" x2="${x - 1}" y2="${mid + 6}" stroke-width="1.2"/>`;
      for (let i = 0; i < flags; i++) out += `<circle class="rest" cx="${x - 1.5}" cy="${mid - 3 + i * 3}" r="1.5"/>`;
      return out;
    }
  }
}

/**
 * Render one system. ctx: { fingerFor(bar, beat, noteIndex), showFingers, lastBar, prevRing }.
 * The returned markup carries data attributes used for hit-testing and the cursor.
 */
export function renderSystem(system, track, ctx = {}) {
  const strings = track.strings;
  const gap = TAB.STRING_GAP;
  const staffH = (strings - 1) * gap;
  const top = TAB.TOP;
  const sb = top + staffH;
  const mid = top + staffH / 2;
  const names = track.tuning ? stringNames(track.tuning) : Array.from({ length: strings }, (_, i) => String(strings - i));
  const out = [];
  out.push(`<svg class="tab-svg" viewBox="0 0 ${system.width} ${system.height}" width="${system.width}" height="${system.height}" data-system="${system.index}" xmlns="http://www.w3.org/2000/svg">`);

  // attach source measures for neighbor lookups
  for (const m of system.measures) m.source = track.measures[m.index];

  // string lines
  const x0 = system.measures[0].x;
  const x1 = system.measures[system.measures.length - 1].x + system.measures[system.measures.length - 1].width;
  for (let s = 0; s < strings; s++) {
    const y = top + s * gap;
    out.push(`<line class="string-line" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`);
    out.push(`<text class="string-name" x="${x0 - 6}" y="${y + 3}" text-anchor="end">${names[s]}</text>`);
  }

  let prevRing = !!ctx.prevRing;
  let lastRunBar = -1;
  system.measures.forEach((m, mi) => {
    const src = m.source;
    out.push(`<line class="barline" x1="${m.x}" y1="${top}" x2="${m.x}" y2="${sb}"/>`);
    if (m.index === ctx.lastBar) {
      out.push(`<line class="barline" x1="${m.x + m.width - 4}" y1="${top}" x2="${m.x + m.width - 4}" y2="${sb}"/>`);
      out.push(`<line class="barline final" x1="${m.x + m.width - 1}" y1="${top}" x2="${m.x + m.width - 1}" y2="${sb}"/>`);
    }
    if (m.marker) out.push(`<text class="marker" x="${m.x + 3}" y="${Y.marker}">${escapeXml(m.marker)}</text>`);
    if (m.sig) {
      out.push(`<text class="time-sig" x="${m.x + 4}" y="${mid - 1}">${m.sig[0]}</text>`);
      out.push(`<text class="time-sig" x="${m.x + 4}" y="${mid + 11}">${m.sig[1]}</text>`);
    }
    out.push(`<text class="bar-number" x="${m.x + 3}" y="${sb + 36}">${m.index + 1}</text>`);

    if (!src.beats.length) {
      out.push(restGlyph(1, m.x + m.width / 2, mid));
      return;
    }

    // let-ring runs
    let runStart = null;
    src.beats.forEach((beat, bi) => {
      const geo = m.beats[bi];
      const ring = !!beat.ring && !beat.rest;
      if (ring && runStart === null) runStart = { x: geo.x - 6, label: !prevRing && lastRunBar !== m.index }; // one label per bar: merged voices ring on and off every beat
      const last = bi === src.beats.length - 1;
      if ((!ring || last) && runStart !== null) {
        const endX = ring ? geo.x + geo.w - 8 : geo.x - 8;
        out.push(`<line class="ring-line" x1="${runStart.x}" y1="${Y.ring}" x2="${Math.max(endX, runStart.x + 4)}" y2="${Y.ring}"/>`);
        if (runStart.label) out.push(`<text class="ring-label" x="${runStart.x}" y="${Y.ringLabel}">let ring</text>`);
        runStart = null;
        lastRunBar = m.index;
      }
      prevRing = ring;
    });

    // beams and tuplets bookkeeping
    let beamStart = null;
    let tupletStart = null;

    src.beats.forEach((beat, bi) => {
      const geo = m.beats[bi];
      const x = geo.x;
      if (beat.chord) out.push(`<text class="chord-name" x="${x - 5}" y="${Y.chord}">${escapeXml(formatChord(beat.chord))}</text>`);

      if (beat.rest) {
        out.push(restGlyph(beat.t, x, mid));
          for (let d = 0; d < (beat.dots || 0); d++) out.push(`<circle class="dot" cx="${x + 6 + d * 3.5}" cy="${mid - 2}" r="1.3"/>`);
      } else {
        beat.notes.forEach((note, ni) => {
          const y = top + note.s * gap;
          const text = fretText(note);
          const w = textWidth(text);
          out.push(`<rect class="fret-bg" x="${x - w / 2 - 1}" y="${y - 6}" width="${w + 2}" height="12"/>`);
          out.push(`<text class="${fretClass(note)}" x="${x}" y="${y + 4.5}">${text}</text>`);
          if (ctx.showFingers !== false && ctx.fingerFor && !note.dead && note.f > 0 && !note.tie) {
            const finger = ctx.fingerFor(m.index, bi, ni);
            if (finger) out.push(`<text class="finger" x="${x + w / 2 + 3}" y="${y - 3.5}">${finger}</text>`);
          }
          if (note.tie) {
            const prev = neighborNote(system, mi, bi, note.s, -1);
            const px = prev ? prev.x + 5 : m.x + 2;
            out.push(`<path class="tie" d="M${px} ${y - 6} Q${(px + x - 5) / 2} ${y - 12} ${x - 5} ${y - 6}"/>`);
          }
          if (note.hp) {
            const next = neighborNote(system, mi, bi, note.s, 1) || nextNoteInTrack(track, m.index, bi, note.s);
            const nx = next && next.x !== null ? next.x - 5 : m.x + m.width - 4;
            const label = next ? (next.note.f > note.f ? 'H' : 'P') : 'H';
            out.push(`<path class="slur" d="M${x + 5} ${y - 6} Q${(x + 5 + nx) / 2} ${y - 13} ${nx} ${y - 6}"/>`);
            out.push(`<text class="tech" x="${(x + 5 + nx) / 2}" y="${y - 11}">${label}</text>`);
          }
          if (note.slide) {
            if (note.slide === 'legato' || note.slide === 'shift') {
              const next = neighborNote(system, mi, bi, note.s, 1);
              const nx = next ? next.x - 6 : x + 14;
              const rising = next ? next.note.f > note.f : true;
              out.push(`<line class="slide" x1="${x + 6}" y1="${rising ? y + 3 : y - 3}" x2="${nx}" y2="${rising ? y - 3 : y + 3}"/>`);
            } else if (note.slide === 'up') {
              out.push(`<line class="slide" x1="${x + 6}" y1="${y + 3}" x2="${x + 14}" y2="${y - 3}"/>`);
            } else if (note.slide === 'down') {
              out.push(`<line class="slide" x1="${x + 6}" y1="${y - 3}" x2="${x + 14}" y2="${y + 3}"/>`);
            } else if (note.slide === 'above') {
              out.push(`<line class="slide" x1="${x - 14}" y1="${y - 3}" x2="${x - 6}" y2="${y + 3}"/>`);
            } else if (note.slide === 'below') {
              out.push(`<line class="slide" x1="${x - 14}" y1="${y + 3}" x2="${x - 6}" y2="${y - 3}"/>`);
            }
          }
          if (note.bend) {
            out.push(`<path class="bend" d="M${x + 5} ${y - 3} Q${x + 12} ${y - 3} ${x + 12} ${y - 12}"/>`);
            out.push(`<polygon class="bend-arrow" points="${x + 9.5},${y - 11} ${x + 14.5},${y - 11} ${x + 12},${y - 15}"/>`);
            out.push(`<text class="tech" x="${x + 12}" y="${y - 17}">${bendLabel(note.bend)}</text>`);
          }
        });

        // rhythm
        const t = beat.t;
        if (t === 1) {
          out.push(`<ellipse class="half-head" cx="${x}" cy="${sb + 12}" rx="3.4" ry="2.3"/>`);
        } else {
          out.push(`<line class="stem" x1="${x}" y1="${sb + (t === 2 ? 9 : 6)}" x2="${x}" y2="${sb + 20}"/>`);
          if (t === 2) out.push(`<ellipse class="half-head" cx="${x}" cy="${sb + 7.5}" rx="3.2" ry="2.2"/>`);
        }
        if (beat.dots) {
          for (let d = 0; d < beat.dots; d++) out.push(`<circle class="dot" cx="${x + 4 + d * 3.5}" cy="${sb + 13}" r="1.3"/>`);
        }
        if (beat.stroke) {
          out.push(`<text class="tech" x="${x}" y="${sb + 30}">${beat.stroke === 'up' ? '↑' : '↓'}</text>`);
        }
      }

      // beams / flags
      const beamed = beat.bs || beamStart !== null;
      if (beat.bs) beamStart = { x, bi };
      if (beat.t >= 8 && !beat.rest) {
        if (!beamed || (beat.bs && beat.be)) {
          const flags = Math.max(1, Math.round(Math.log2(beat.t)) - 2); // 8th 1, 16th 2, 32nd 3, 64th 4
          for (let f = 0; f < flags; f++) out.push(`<path class="flag" d="M${x} ${sb + 20 - f * 3} c 1 -3 6 -3 6 -8"/>`);
        }
      }
      if (beat.be && beamStart !== null) {
        if (beamStart.bi !== bi) {
          out.push(`<line class="beam" x1="${beamStart.x}" y1="${sb + 20}" x2="${x}" y2="${sb + 20}"/>`);
          // further beams for runs of sixteenths, thirty-seconds and sixty-fourths
          for (let k = beamStart.bi; k < bi; k++) {
            const a = src.beats[k];
            const b = src.beats[k + 1];
            for (let level = 16, row = 1; level <= 64; level *= 2, row++) {
              if (a.t >= level && b.t >= level) out.push(`<line class="beam" x1="${m.beats[k].x}" y1="${sb + 20 - 3.5 * row}" x2="${m.beats[k + 1].x}" y2="${sb + 20 - 3.5 * row}"/>`);
            }
          }
        }
        beamStart = null;
      }
      if (beat.ts) tupletStart = { x, bi };
      if (beat.te && tupletStart !== null) {
        const cx = (tupletStart.x + x) / 2;
        // A beamed group needs only the number; anything else gets the bracket.
        const group = src.beats.slice(tupletStart.bi, bi + 1);
        const beamedGroup = group.length > 1 && group[0].bs && beat.be && group.every((b) => b.t >= 8 && !b.rest);
        if (!beamedGroup) {
          const by = sb + 25.5;
          out.push(`<path class="tuplet-bracket" d="M${tupletStart.x - 3} ${by + 2.5} V${by} H${cx - 5} M${cx + 5} ${by} H${x + 3} V${by + 2.5}"/>`);
        }
        out.push(`<text class="tuplet" x="${cx}" y="${sb + 29}">${beat.tuplet || 3}</text>`);
        tupletStart = null;
      }
    });
  });

  // active-bar tint, hit targets and cursor on top (the tint sits above the note backgrounds so it has no holes)
  for (const m of system.measures) {
    out.push(`<rect class="measure-bg" data-bar="${m.index}" x="${m.x}" y="0" width="${m.width}" height="${system.height}"/>`);
  }
  for (const m of system.measures) {
    const barLabel = ctx.barLabel ? ctx.barLabel(m.index + 1) : `Bar ${m.index + 1}`;
    out.push(`<rect class="measure-hit" data-bar="${m.index}" x="${m.x}" y="0" width="${m.width}" height="${system.height}" tabindex="0" role="button" aria-label="${escapeXml(barLabel)}"/>`);
  }
  out.push(`<rect class="cursor is-hidden" data-cursor x="0" y="${top - 8}" width="0" height="${staffH + 16}" rx="3"/>`);
  out.push('</svg>');
  return out.join('');
}
