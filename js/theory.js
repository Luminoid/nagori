// Note names, tunings and scales shared by the tools page.

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export function pitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

export function noteName(midi, { flats = false } = {}) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
}

/** Scientific octave: MIDI 60 is C4. */
export function octaveOf(midi) {
  return Math.floor(midi / 12) - 1;
}

export function noteLabel(midi, options) {
  return `${noteName(midi, options)}${octaveOf(midi)}`;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Tunings as MIDI numbers, highest string first (the tab order). `name` is an i18n key. */
export const TUNINGS = [
  { id: 'standard', name: 'tuning.standard', kind: 'guitar', midi: [64, 59, 55, 50, 45, 40] },
  { id: 'dropD', name: 'tuning.dropD', kind: 'guitar', midi: [64, 59, 55, 50, 45, 38] },
  { id: 'halfDown', name: 'tuning.halfDown', kind: 'guitar', midi: [63, 58, 54, 49, 44, 39] },
  { id: 'dadgad', name: 'tuning.dadgad', kind: 'guitar', midi: [62, 57, 55, 50, 45, 38] },
  { id: 'dadfbe', name: 'tuning.dadfbe', kind: 'guitar', midi: [64, 59, 54, 50, 45, 38] },
  { id: 'openG', name: 'tuning.openG', kind: 'guitar', midi: [62, 59, 55, 50, 43, 38] },
  { id: 'bass', name: 'tuning.bass', kind: 'bass', midi: [43, 38, 33, 28] },
];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** Whether a pitch class belongs to `scale` on `root`; everything is in when there is no scale. */
export function inScale(pc, root, scale) {
  if (root === null || root === undefined || !scale || !SCALES[scale]) return true;
  return SCALES[scale].includes(pitchClass(pc - root));
}

/** Every note on the neck: rows per string (highest first), columns per fret from the open string. */
export function fretboardNotes(tuning, frets = 15) {
  return tuning.map((open, string) => Array.from({ length: frets + 1 }, (_, fret) => ({ string, fret, midi: open + fret, pc: pitchClass(open + fret) })));
}

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C minor", "G# minor", "Bb", "D major" -> { root, scale, flats }; null when the text is not a key. */
export function parseKey(key) {
  const m = /^\s*([A-G])([#♯b♭]?)\s*(major|minor|maj|min|m)?\s*(?:\([^)]*\))?\s*$/.exec(key || ''); // "E", "A♭ minor", "G minor (capo 1)"
  if (!m) return null;
  const accidental = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const quality = m[3] || 'major';
  return { root: pitchClass(LETTER_PC[m[1]] + accidental), scale: quality === 'major' || quality === 'maj' ? 'major' : 'minor', flats: accidental < 0 };
}

/** The tools-page tuning matching a track's MIDI tuning, or null for one the tools do not offer. */
export function tuningFor(midi) {
  if (!Array.isArray(midi)) return null;
  return TUNINGS.find((tuning) => tuning.midi.length === midi.length && tuning.midi.every((m, i) => m === midi[i])) || null;
}
