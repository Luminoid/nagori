// Built-in chord voicings, so a song needs no hand-written library to get
// chord diagrams and library-quality fingerings: the common open chords plus
// the movable E-form and A-form barre shapes for every root, and the movable
// diminished, augmented and sixth shapes, in six-string standard tuning. A song's own `chordLibrary` and a part's `chordLibrary`
// come first when they name the same chord, so curated voicings always win
// and are what the chords view draws.

import { chordKey } from './util.js';
import { parseVoicing } from './chord-diagram.js';

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Open-position voicings, low string to high: name -> [frets, fingers]. */
const OPEN = {
  C: ['x32010', 'x32010'],
  D: ['xx0232', 'xx0132'],
  E: ['022100', '023100'],
  G: ['320003', '210003'],
  A: ['x02220', 'x01230'],
  Am: ['x02210', 'x02310'],
  Dm: ['xx0231', 'xx0231'],
  Em: ['022000', '023000'],
  E7: ['020100', '020100'],
  A7: ['x02020', 'x02030'],
  D7: ['xx0212', 'xx0213'],
  G7: ['320001', '320001'],
  C7: ['x32310', 'x32410'],
  B7: ['x21202', 'x21304'],
  Cmaj7: ['x32000', 'x32000'],
  Amaj7: ['x02120', 'x02130'],
  Dmaj7: ['xx0222', 'xx0111'],
  Fmaj7: ['xx3210', 'xx3210'],
  Em7: ['022030', '023040'],
  Am7: ['x02010', 'x02010'],
  Dm7: ['xx0211', 'xx0211'],
  Asus2: ['x02200', 'x01200'],
  Asus4: ['x02230', 'x01230'],
  Dsus2: ['xx0230', 'xx0130'],
  Dsus4: ['xx0233', 'xx0134'],
  Esus4: ['022200', '023400'],
  Cadd9: ['x32030', 'x21030'],
  E5: ['022xxx', '013xxx'],
  A5: ['x022xx', 'x013xx'],
  D5: ['xx023x', 'xx013x'],
};

/** Movable shapes: [suffix, root string (5 = low E, 4 = A), frets with the barre at 1, fingers]. */
/**
 * Movable shapes: suffix, the string whose digit 1 sets the position (index
 * in STANDARD_TUNING, high string first), the pattern with 1 as its lowest
 * fret, the fingers, and the interval in semitones that string sounds above
 * the root (0 when it carries the root). Shapes whose lowest fret is not the
 * root, such as the diminished sevenths, use the interval.
 */
const MOVABLE = [
  ['', 5, '133211', '134211'],
  ['m', 5, '133111', '134111'],
  ['7', 5, '131211', '131211'],
  ['m7', 5, '131111', '131111'],
  ['sus4', 5, '133311', '123411'],
  ['5', 5, '133xxx', '134xxx'],
  ['', 4, 'x13331', 'x12341'],
  ['m', 4, 'x13321', 'x13421'],
  ['7', 4, 'x13131', 'x13141'],
  ['m7', 4, 'x13121', 'x13121'],
  ['maj7', 4, 'x1323x', 'x1324x'],
  ['sus4', 4, 'x13341', 'x12341'],
  ['5', 4, 'x133xx', 'x134xx'],
  ['dim', 4, 'x12x2x', 'x12x3x'],
  ['dim7', 2, 'x2313x', 'x2314x', 9],
  ['dim7', 3, 'xx1212', 'xx1324'],
  ['aug', 2, 'x3211x', 'x4312x', 8],
  ['aug', 3, 'xx1443', 'xx1342'],
  ['6', 2, 'x2414x', 'x2314x', 9],
  ['6', 3, '2x1322', '2x1433', 9],
  ['m6', 2, 'x2413x', 'x2413x', 9],
];

function transpose(pattern, fret) {
  const frets = [...pattern].map((c) => (c === 'x' ? 'x' : String(Number(c) + fret - 1)));
  return frets.some((f) => f.length > 1) ? frets.join(' ') : frets.join('');
}

function build() {
  const out = new Map();
  const add = (name, frets, fingers, base) => {
    const key = chordKey(name);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ frets, fingers, base });
  };
  for (const [name, [frets, fingers]] of Object.entries(OPEN)) add(name, frets, fingers, 0);
  for (let pc = 0; pc < 12; pc++) {
    const spellings = SHARP[pc] === FLAT[pc] ? [SHARP[pc]] : [SHARP[pc], FLAT[pc]];
    for (const [suffix, refString, pattern, fingers, interval = 0] of MOVABLE) {
      const openPitch = STANDARD_TUNING[refString] % 12;
      const fret = (((pc + interval - openPitch) % 12) + 12) % 12;
      if (fret === 0) continue; // the open chord covers it, or the shape would need an open string
      for (const root of spellings) add(root + suffix, transpose(pattern, fret), fingers, fret);
    }
  }
  const library = {};
  for (const [key, list] of out) {
    list.sort((a, b) => a.base - b.base);
    library[key] = list.map(({ frets, fingers }) => ({ frets, fingers }));
  }
  return library;
}

let standard = null;

/** The built-in library for a tuning (only standard six-string has one), keyed by chordKey. */
export function sharedLibrary(tuning) {
  if (!tuning || tuning.length !== 6 || tuning.some((m, i) => m !== STANDARD_TUNING[i])) return {};
  if (!standard) standard = build();
  return standard;
}

/**
 * The chord library a track is fingered and drawn with: the part's own
 * voicings, then the song's, then the built-in ones for the part's tuning.
 * Keys are normalized with chordKey (flats as "b", sharps as "#").
 */
export function libraryFor(song, track = null) {
  const tuning = track?.tuning || song?.tracks?.find((t) => t.kind === 'guitar' && t.tuning)?.tuning || null;
  const out = {};
  const add = (library) => {
    for (const [name, entry] of Object.entries(library || {})) {
      const key = chordKey(name);
      if (!out[key]) out[key] = [];
      for (const voicing of Array.isArray(entry) ? entry : [entry]) {
        if (!out[key].some((v) => v.frets === voicing.frets)) out[key].push(voicing);
      }
    }
  };
  add(track?.chordLibrary);
  add(song?.chordLibrary);
  add(sharedLibrary(tuning));
  return out;
}

/** The qualities the chord dictionary offers: the suffix as written in chord names, and the i18n key of its label. */
export const QUALITIES = [
  { suffix: '', label: 'dict.q.major' },
  { suffix: 'm', label: 'dict.q.minor' },
  { suffix: '7', label: 'dict.q.dom7' },
  { suffix: 'm7', label: 'dict.q.min7' },
  { suffix: 'maj7', label: 'dict.q.maj7' },
  { suffix: 'sus2', label: 'dict.q.sus2' },
  { suffix: 'sus4', label: 'dict.q.sus4' },
  { suffix: 'add9', label: 'dict.q.add9' },
  { suffix: '6', label: 'dict.q.six' },
  { suffix: 'm6', label: 'dict.q.min6' },
  { suffix: 'dim', label: 'dict.q.dim' },
  { suffix: 'dim7', label: 'dict.q.dim7' },
  { suffix: 'aug', label: 'dict.q.aug' },
  { suffix: '5', label: 'dict.q.power' },
];

/** A dictionary entry: the chord name for a root pitch class and a quality, and its built-in voicings (open first). */
export function dictionaryEntry(pc, suffix, { flats = false } = {}) {
  const root = (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
  const name = root + suffix;
  return { name, voicings: sharedLibrary(STANDARD_TUNING)[chordKey(name)] || [] };
}

/** The MIDI notes of a voicing, low string to high, muted strings left out (what strumming it plays). */
export function voicingMidi(frets, tuning = STANDARD_TUNING) {
  const out = [];
  parseVoicing(frets).forEach((fret, i) => {
    const open = tuning[tuning.length - 1 - i];
    if (fret !== null && !Number.isNaN(fret) && open !== undefined) out.push(open + fret);
  });
  return out;
}

/** "Bbm7", "F♯", "Dm/F" -> { root: pitch class, suffix, flats }, or null when the text is not a chord name. */
export function parseChordName(name) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/.*)?$/.exec(chordKey(name || '').trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { root: (base + accidental + 12) % 12, suffix: m[3], flats: accidental < 0 };
}
