// Left-hand fingering for a track.
//
// The track is cut into "positions": runs of beats whose fretted notes fit
// under one hand (span of at most MAX_SPAN frets, no two different frets on
// one string while notes ring), starting a new position when the chord
// changes and the beat brings new notes. Each position is then fingered from,
// in order of preference:
//   1. a curated override keyed by the set of notes,
//   2. the song's chord library, when a label of the position matches and
//      the notes fit that voicing (hold the chord, pick the strings; up to
//      two passing notes on otherwise open or muted strings are allowed),
//   3. a small solver: barre detection plus one-finger-per-fret with a cost
//      for deviations, or plain positional fingering for melodic runs.
//
// The solver fingers from a hand position (the fret under the index finger):
// the previous position's when the notes still fit under it, first position
// when open strings ring and nothing sits above the 4th fret, else the lowest
// fretted note. A library match must hold at least as many notes of the
// voicing as it adds outside it; passing notes take a free finger inside the
// hand span, never one the chord already uses on another fret.
//
// Chord labels come from the track's own annotations first, then from the
// song-level chord timeline, so every track (bass included) gets names.
// Fingers: 1 index, 2 middle, 3 ring, 4 pinky, 0 open string.

import { chordKey, durationValue } from './util.js';
import { parseVoicing, inferBarre } from './chord-diagram.js';

const MAX_SPAN = 3;
const MAX_EXTRAS = 2;

const noteKey = (s, f) => `${s}:${f}`;
const clampFinger = (f) => Math.min(4, Math.max(1, f));

/**
 * Why a voicing's fingering is unusable, or null when it is fine: the finger
 * string must match the frets string, every fretted note needs a finger, open
 * and muted strings none, and one finger cannot sit on two frets.
 */
export function voicingProblem(fretsText, fingersText) {
  const frets = parseVoicing(fretsText);
  const fingers = fingersText ? parseVoicing(fingersText) : null;
  if (!fingers) return null;
  if (fingers.length !== frets.length) return 'fingers do not match the strings';
  const fretOf = new Map();
  for (let i = 0; i < frets.length; i++) {
    const fret = frets[i];
    const finger = fingers[i];
    if (fret === null || Number.isNaN(fret)) {
      if (finger !== null && finger !== 0 && !Number.isNaN(finger)) return `finger on the muted string ${i + 1}`;
      continue;
    }
    if (fret === 0) {
      if (finger) return `finger on the open string ${i + 1}`;
      continue;
    }
    if (!finger || finger > 4) return `no finger for fret ${fret} on string ${i + 1}`;
    if (fretOf.has(finger) && fretOf.get(finger) !== fret) return `finger ${finger} on frets ${fretOf.get(finger)} and ${fret}`;
    fretOf.set(finger, fret);
  }
  return null;
}

function normalizeLibrary(library, strings) {
  const shapes = new Map();
  for (const [name, entry] of Object.entries(library || {})) {
    const voicings = Array.isArray(entry) ? entry : [entry];
    const list = voicings
      .map((v) => {
        const frets = parseVoicing(v.frets);
        if (frets.length !== strings) return null;
        if (voicingProblem(v.frets, v.fingers)) return null;
        const fingers = v.fingers ? parseVoicing(v.fingers) : null;
        const notes = new Map();
        const opens = [];
        const mutes = [];
        const freeStrings = new Set();
        frets.forEach((fret, i) => {
          const s = strings - 1 - i;
          if (fret === null || Number.isNaN(fret)) {
            mutes.push(s);
            freeStrings.add(s);
          } else if (fret === 0) {
            opens.push(s);
            freeStrings.add(s);
          } else notes.set(noteKey(s, fret), { s, f: fret, finger: fingers ? fingers[i] || null : null });
        });
        const base = notes.size ? Math.min(...[...notes.values()].map((n) => n.f)) : 1;
        return { name, frets: v.frets, fingers: v.fingers || null, notes, opens, mutes, freeStrings, base };
      })
      .filter(Boolean);
    if (list.length) shapes.set(chordKey(name), list);
  }
  return shapes;
}

function labelLookup(chordTimeline) {
  const entries = (chordTimeline || []).slice().sort((a, b) => a.bar - b.bar || a.pos - b.pos);
  let i = 0;
  let current = null;
  return (bar, pos) => {
    while (i < entries.length && (entries[i].bar < bar || (entries[i].bar === bar && entries[i].pos <= pos + 1e-6))) {
      current = entries[i].chord;
      i++;
    }
    return current;
  };
}

function newSegment(m, b, ownChord, timelineLabel) {
  const labels = [];
  for (const l of [ownChord, timelineLabel]) if (l && !labels.includes(l)) labels.push(l);
  return {
    ownChord: ownChord || null,
    timelineLabel: timelineLabel || null,
    labels,
    notes: new Map(),
    byString: new Map(),
    opens: new Set(),
    ring: false,
    chordal: false,
    beats: [],
    min: Infinity,
    max: -Infinity,
    startBar: m,
    startBeat: b,
    endBar: m,
    endBeat: b,
  };
}

function segmentTrack(track, maxSpan, chordTimeline) {
  const segments = [];
  const labelAt = labelLookup(chordTimeline);
  let cur = null;
  const close = () => {
    if (cur) segments.push(cur);
    cur = null;
  };
  track.measures.forEach((measure, m) => {
    const total = measure.beats.reduce((a, b) => a + durationValue(b), 0) || 1;
    let acc = 0;
    measure.beats.forEach((beat, b) => {
      const pos = acc / total;
      acc += durationValue(beat);
      const timelineLabel = labelAt(m, pos);
      if (beat.rest || !beat.notes || !beat.notes.length) return;
      const fretted = [];
      const opens = [];
      for (const n of beat.notes) {
        if (n.dead) continue;
        if (n.f > 0) fretted.push(n);
        else opens.push(n);
      }
      if (!fretted.length && !opens.length) return;
      if (cur) {
        const ownChange = !!beat.chord && beat.chord !== cur.ownChord;
        const newNotes = fretted.some((n) => !cur.notes.has(noteKey(n.s, n.f)));
        // The harmony (song timeline) moved on since this position started and the beat adds notes: new position.
        const harmonyChange = cur.notes.size > 0 && !!timelineLabel && !!cur.timelineLabel && timelineLabel !== cur.timelineLabel && newNotes;
        if (ownChange || harmonyChange) close();
      }
      if (cur && fretted.length) {
        const lo = Math.min(cur.min, ...fretted.map((n) => n.f));
        const hi = Math.max(cur.max, ...fretted.map((n) => n.f));
        const holds = cur.ring || beat.ring;
        const conflict = holds && fretted.some((n) => cur.byString.has(n.s) && cur.byString.get(n.s) !== n.f);
        if (hi - lo > maxSpan || conflict) close();
      }
      if (!cur) cur = newSegment(m, b, beat.chord, timelineLabel);
      else {
        if (timelineLabel && !cur.notes.size) cur.timelineLabel = timelineLabel;
        for (const l of [beat.chord, timelineLabel]) if (l && !cur.labels.includes(l)) cur.labels.push(l);
      }
      if (beat.chord && !cur.ownChord) cur.ownChord = beat.chord;
      for (const n of fretted) {
        cur.notes.set(noteKey(n.s, n.f), { s: n.s, f: n.f });
        cur.byString.set(n.s, n.f);
        cur.min = Math.min(cur.min, n.f);
        cur.max = Math.max(cur.max, n.f);
      }
      for (const n of opens) cur.opens.add(n.s);
      if (beat.ring) cur.ring = true;
      if (fretted.length >= 2) cur.chordal = true;
      cur.beats.push([m, b]);
      cur.endBar = m;
      cur.endBeat = b;
    });
  });
  close();
  return segments;
}

function sortedNotes(seg) {
  return [...seg.notes.values()].sort((a, b) => a.f - b.f || b.s - a.s);
}

/**
 * Try every voicing of every label; the position's notes must sit inside the
 * voicing, bar a couple of passing notes on strings the voicing leaves open or
 * muted. The voicing needing the fewest passing notes wins (label order breaks ties).
 */
/**
 * A finger for a passing note played while a chord is held: inside the hand
 * span, preferring one finger per fret, never a finger the chord uses on another
 * fret (the index may add a string at its own fret, as a wider barre).
 */
function extraFinger(fret, base, used) {
  if (fret < base || fret > base + MAX_SPAN) return null;
  const pref = fret - base + 1;
  const candidates = [pref, pref + 1, pref + 2, pref + 3, pref - 1, pref - 2, pref - 3].filter((f) => f >= 1 && f <= 4);
  for (const f of candidates) {
    if (!used.has(f)) return f;
    if (f === 1 && used.get(f) === fret) return f;
  }
  return null;
}

function resolveLibrary(seg, shapes) {
  const notes = sortedNotes(seg);
  if (!notes.length) return null;
  const tryShape = (shape, label) => {
    const extras = notes.filter((n) => !shape.notes.has(noteKey(n.s, n.f)));
    const held = notes.length - extras.length;
    // Holding the chord means most of what is played comes from it.
    if (!held || extras.length > MAX_EXTRAS || extras.length > held) return null;
    if (!extras.every((n) => shape.freeStrings.has(n.s))) return null;
    const fingers = new Map();
    const used = new Map();
    for (const n of shape.notes.values()) if (n.finger) used.set(n.finger, n.f);
    for (const n of notes) {
      const key = noteKey(n.s, n.f);
      const inShape = shape.notes.get(key);
      if (!inShape) continue;
      if (!inShape.finger) return null;
      fingers.set(key, inShape.finger);
    }
    for (const n of extras) {
      const finger = extraFinger(n.f, shape.base, used);
      if (!finger) return null;
      fingers.set(noteKey(n.s, n.f), finger);
      used.set(finger, n.f);
    }
    return { fingers, shape, label, extras: new Set(extras.map((n) => noteKey(n.s, n.f))) };
  };
  let best = null;
  for (const label of seg.labels) {
    for (const shape of shapes.get(chordKey(label)) || []) {
      const hit = tryShape(shape, label);
      if (hit && (!best || hit.extras.size < best.extras.size)) best = hit;
      if (best && !best.extras.size) return best;
    }
  }
  if (best) return best;
  // No labelled voicing fits: fall back to any voicing that holds exactly these notes
  // (same root as the label preferred), so the hand still gets a known chord shape.
  const root = seg.labels.length ? chordKey(seg.labels[0]).match(/^[A-G][b#]?/)?.[0] : null;
  const candidates = [...shapes.entries()].sort(([a], [b]) => (b.startsWith(root || '\u0000') ? 1 : 0) - (a.startsWith(root || '\u0000') ? 1 : 0));
  for (const [, list] of candidates) {
    for (const shape of list) {
      if (notes.length < 2 || notes.length * 2 < shape.notes.size) continue; // must cover at least half the voicing
      const hit = tryShape(shape, seg.labels[0] || shape.name);
      if (hit && !hit.extras.size) return { ...hit, borrowed: true };
    }
  }
  return null;
}

/** Merge runs of unresolved, unannotated single-note positions into one melodic position. */
function mergeSingles(segments, maxSpan) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    const mergeable = prev && !prev.resolved && !seg.resolved && prev.notes.size <= 1 && seg.notes.size <= 1 && !seg.ownChord;
    if (mergeable) {
      const min = Math.min(prev.min, seg.min);
      const max = Math.max(prev.max, seg.max);
      if (max - min <= maxSpan) {
        for (const [key, note] of seg.notes) prev.notes.set(key, note);
        for (const s of seg.opens) prev.opens.add(s);
        for (const label of seg.labels) if (!prev.labels.includes(label)) prev.labels.push(label);
        prev.beats.push(...seg.beats);
        prev.endBar = seg.endBar;
        prev.endBeat = seg.endBeat;
        prev.min = min;
        prev.max = max;
        prev.merged = true;
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/**
 * Finger a melodic run one finger per fret from the hand position (the fret
 * under the index finger; the lowest note by default).
 */
export function solveMelody(notes, { position = null } = {}) {
  const fingers = new Map();
  if (!notes.length) return { fingers, barre: null, baseFret: 1, position: position || 1 };
  const base = Math.min(...notes.map((n) => n.f));
  const hand = position ?? base;
  for (const n of notes) fingers.set(noteKey(n.s, n.f), clampFinger(n.f - hand + 1));
  return { fingers, barre: null, baseFret: base, position: hand };
}

/**
 * Finger a held shape. notes: unique fretted notes; opens: Set of open string
 * indices that ring inside the shape (they forbid a barre across them);
 * position: the fret under the index finger (the lowest note by default).
 */
export function solveShape(notes, opens = new Set(), { position = null } = {}) {
  if (!notes.length) return { fingers: new Map(), barre: null, baseFret: 1, position: position || 1 };
  const sorted = [...notes].sort((a, b) => a.f - b.f || b.s - a.s);
  const base = sorted[0].f;
  const hand = position ?? base;
  const atBase = sorted.filter((n) => n.f === base);
  let barre = null;
  if (atBase.length >= 2) {
    const from = Math.max(...atBase.map((n) => n.s));
    const to = Math.min(...atBase.map((n) => n.s));
    const inner = sorted.some((n) => n.f > base && n.s > to && n.s < from);
    // A real barre: three notes on the base fret, or two with other fingers working inside the span.
    let ok = from - to + 1 >= 3 && (atBase.length >= 3 || inner);
    for (let s = to + 1; s < from && ok; s++) if (opens.has(s)) ok = false;
    if (ok) barre = { fret: base, from, to };
  }
  const fingers = new Map();
  const rest = [];
  for (const n of sorted) {
    if (barre && n.f === base && n.s <= barre.from && n.s >= barre.to) fingers.set(noteKey(n.s, n.f), 1);
    else rest.push(n);
  }
  const minFinger = barre ? 2 : 1;
  const assign = new Array(rest.length);
  let best = null;
  const search = (i, prevFinger, prevFret, cost) => {
    if (best && cost >= best.cost) return;
    if (i === rest.length) {
      best = { cost, fingers: assign.slice() };
      return;
    }
    const n = rest[i];
    const pref = clampFinger(n.f - hand + 1);
    for (let f = Math.max(minFinger, prevFinger); f <= 4; f++) {
      const sameFinger = i > 0 && f === prevFinger;
      if (sameFinger && n.f !== prevFret) continue; // one finger cannot hold two frets
      assign[i] = f;
      // Reaching a lower finger up the neck is harder than using a higher one, so the cost is asymmetric.
      const deviation = f < pref ? (pref - f) * 1.5 : f - pref;
      search(i + 1, f, n.f, cost + deviation + (sameFinger ? 4 : 0));
    }
  };
  search(0, 0, -1, 0);
  if (!best) return { ...solveMelody(sorted, { position: hand }), barre: null };
  rest.forEach((n, i) => fingers.set(noteKey(n.s, n.f), best.fingers[i]));
  return { fingers, barre, baseFret: base, position: hand };
}

/** The fret under the index finger for a fingered set of notes: finger 1's fret, else inferred from the lowest note. */
function positionOf(notes, fingers) {
  let lowest = null;
  for (const n of notes) {
    const finger = fingers.get(noteKey(n.s, n.f));
    if (!finger) continue;
    if (finger === 1) return n.f;
    if (!lowest || n.f < lowest.f) lowest = { f: n.f, finger };
  }
  return lowest ? Math.max(1, lowest.f - lowest.finger + 1) : null;
}

/**
 * Where the hand goes for a position the solver fingers: stays where it was
 * when the notes fit under it, first position for open-string playing that
 * stays below the 5th fret, else the lowest fretted note.
 */
function choosePosition(seg, hand) {
  if (seg.min === Infinity) return hand;
  if (hand && seg.min >= hand && seg.max <= hand + MAX_SPAN) return hand;
  if (seg.opens.size && seg.max <= MAX_SPAN + 1) return 1;
  return seg.min;
}

function solveSegment(seg, overrides, trackId, hand) {
  const notes = sortedNotes(seg);
  seg.key = notes.map((n) => noteKey(n.s, n.f)).join(',');
  seg.chord = seg.labels[0] || null;
  seg.extras = new Set();
  const override = overrides[`${trackId}|${seg.key}`] || overrides[seg.key];
  if (override) {
    seg.fingers = new Map(Object.entries(override).map(([k, v]) => [k, Number(v)]));
    seg.source = 'override';
    seg.barre = inferBarre(notes.map((n) => ({ ...n, finger: seg.fingers.get(noteKey(n.s, n.f)) })));
    seg.baseFret = notes.length ? notes[0].f : 1;
    seg.position = positionOf(notes, seg.fingers) || hand;
    return;
  }
  if (seg.resolved) {
    seg.fingers = seg.resolved.fingers;
    seg.libraryShape = seg.resolved.shape;
    seg.chord = seg.resolved.label;
    seg.extras = seg.resolved.extras;
    seg.shapeName = seg.resolved.borrowed ? seg.resolved.shape.name : null;
    seg.source = 'library';
    seg.barre = inferBarre([...seg.libraryShape.notes.values()]);
    seg.baseFret = seg.libraryShape.base;
    const held = [...seg.libraryShape.notes.values()];
    seg.position = positionOf(held, new Map(held.map((n) => [noteKey(n.s, n.f), n.finger]))) || seg.libraryShape.base;
    return;
  }
  const position = choosePosition(seg, hand);
  const result = seg.kind === 'shape' ? solveShape(notes, seg.opens, { position }) : solveMelody(notes, { position });
  seg.fingers = result.fingers;
  seg.barre = result.barre;
  seg.baseFret = result.baseFret;
  seg.position = result.position;
  seg.source = 'solver';
}

/**
 * Analyze one track. Returns positions (segments) and lookups for the tab
 * renderer: fingerFor(bar, beat, noteIndex) and segmentAt(bar, beat).
 */
export function analyzeTrack(track, { library = {}, overrides = {}, chordTimeline = [], maxSpan = MAX_SPAN, trackId = track.id } = {}) {
  const shapes = normalizeLibrary(library, track.strings);
  let segments = segmentTrack(track, maxSpan, chordTimeline);
  for (const seg of segments) seg.resolved = resolveLibrary(seg, shapes);
  segments = mergeSingles(segments, maxSpan);
  let hand = null;
  segments.forEach((seg, i) => {
    seg.index = i;
    seg.kind = (seg.ring || seg.chordal) && !seg.merged ? 'shape' : 'melody';
    solveSegment(seg, overrides, trackId, hand);
    hand = seg.position || hand;
  });
  const beatSegment = new Map();
  const noteFinger = new Map();
  for (const seg of segments) {
    for (const [m, b] of seg.beats) {
      beatSegment.set(`${m}:${b}`, seg.index);
      const beat = track.measures[m].beats[b];
      beat.notes.forEach((n, ni) => {
        if (n.dead) return;
        noteFinger.set(`${m}:${b}:${ni}`, n.f === 0 ? 0 : (seg.fingers.get(noteKey(n.s, n.f)) ?? null));
      });
    }
  }
  return {
    segments,
    fingerFor: (m, b, ni) => noteFinger.get(`${m}:${b}:${ni}`) ?? null,
    segmentAt: (m, b) => {
      const idx = beatSegment.get(`${m}:${b}`);
      return idx === undefined ? null : segments[idx];
    },
  };
}

/** Diagram-ready shape for a position card. */
function segmentShape(seg, strings) {
  if (seg.libraryShape) {
    const played = new Set(seg.notes.keys());
    const notes = [...seg.libraryShape.notes.values()].map((n) => ({ ...n, played: played.has(noteKey(n.s, n.f)) }));
    for (const key of seg.extras) {
      const note = seg.notes.get(key);
      notes.push({ s: note.s, f: note.f, finger: seg.fingers.get(key) || null, played: true, extra: true });
    }
    const extraStrings = new Set([...seg.extras].map((k) => seg.notes.get(k).s));
    return {
      strings,
      notes,
      opens: seg.libraryShape.opens.filter((s) => !extraStrings.has(s)),
      mutes: seg.libraryShape.mutes.filter((s) => !extraStrings.has(s)),
      barre: seg.barre,
      baseFret: seg.baseFret,
    };
  }
  return {
    strings,
    notes: sortedNotes(seg).map((n) => ({ ...n, finger: seg.fingers.get(noteKey(n.s, n.f)) || null, played: true })),
    opens: [...seg.opens],
    mutes: [],
    barre: seg.barre,
    baseFret: seg.baseFret,
  };
}

/**
 * Group positions by song section, de-duplicated by shape, for the gallery.
 * sections: [{ name, bar }]; returns [{ name, startBar, endBar, cards }].
 */
export function positionsBySection(analysis, sections, barCount, strings, { minNotes = 2 } = {}) {
  const bounds = sections.map((sec, i) => ({
    name: sec.name,
    startBar: sec.bar,
    endBar: (sections[i + 1] ? sections[i + 1].bar : barCount) - 1,
    cards: new Map(),
  }));
  if (!bounds.length) bounds.push({ name: 'Song', startBar: 0, endBar: barCount - 1, cards: new Map() });
  for (const seg of analysis.segments) {
    if (!seg.notes.size) continue;
    const section = bounds.find((b) => seg.startBar >= b.startBar && seg.startBar <= b.endBar) || bounds[bounds.length - 1];
    const dedupe = `${seg.kind}|${seg.key}|${seg.libraryShape ? seg.libraryShape.frets : ''}`;
    let card = section.cards.get(dedupe);
    if (!card) {
      card = {
        key: dedupe,
        chord: seg.chord,
        labels: seg.labels,
        shapeName: seg.shapeName || null,
        kind: seg.kind,
        source: seg.source,
        shape: segmentShape(seg, strings),
        bars: new Set(),
        segments: [],
      };
      section.cards.set(dedupe, card);
    }
    card.segments.push(seg);
    for (let bar = seg.startBar; bar <= seg.endBar; bar++) card.bars.add(bar + 1);
  }
  return bounds.map((b) => {
    const all = [...b.cards.values()].map((c) => ({ ...c, bars: [...c.bars].sort((x, y) => x - y) }));
    // Single-note fragments (pickups, passing notes) stay in the tab but would only clutter the gallery.
    const kept = all.filter((c) => c.shape.notes.filter((n) => n.played !== false).length >= minNotes || c.source === 'library');
    return { ...b, cards: kept.length ? kept : all };
  });
}

/** Compact finger string for a card, low string to high: "x13421". */
export function fingerString(shape) {
  const byString = new Map();
  for (const n of shape.notes) if (n.played !== false || n.finger) byString.set(n.s, n.finger || '?');
  for (const s of shape.opens || []) byString.set(s, 0);
  for (const s of shape.mutes || []) byString.set(s, 'x');
  const out = [];
  for (let s = shape.strings - 1; s >= 0; s--) out.push(byString.has(s) ? byString.get(s) : '·');
  return out.join('');
}
