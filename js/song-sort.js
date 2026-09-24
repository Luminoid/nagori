// Order of the home page's song list: the sort modes, their comparators and
// the grouping that puts a heading over a run of the same artist or key. Pure
// functions over index rows (data/songs.json), so Node tests cover them.

import { parseKey } from './theory.js';

export const SORTS = ['artist', 'title', 'newest', 'key', 'tempo', 'length'];
export const DEFAULT_SORT = 'artist';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** "m:ss" or "h:mm:ss" as seconds; null when absent or malformed. */
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(':');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** A title or artist without its leading article, for alphabetical order. */
export function sortName(text) {
  return String(text || '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

/** How a row sorts by artist: the curated `artistSort` ("Bach, Johann Sebastian") when given, else the artist as written. */
export const artistKey = (song) => sortName(song.artistSort || song.artist);

const byTitle = (a, b) => collator.compare(sortName(a.title), sortName(b.title)) || collator.compare(a.id || '', b.id || '');

/** Ascending on a number, rows without one last. */
function numeric(get, a, b) {
  const x = get(a);
  const y = get(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

/**
 * A key as a heading reads: "E" becomes "E major", "Em" "E minor", and a note
 * after the key ("A♭ minor (G minor shapes, capo 1)") is dropped, so songs
 * that spell the same key differently share one heading. Text the parser
 * does not know stays as written.
 */
export function keyLabel(key) {
  const parsed = parseKey(key);
  const root = /^\s*([A-G][#♯b♭]?)/.exec(key || '');
  return parsed && root ? `${root[1]} ${parsed.scale}` : key;
}

/** Keys in circle order from C, each major before its parallel minor. */
function keyRank(song) {
  const parsed = parseKey(song.key);
  return parsed ? parsed.root * 2 + (parsed.scale === 'minor' ? 1 : 0) : null;
}

const COMPARE = {
  artist: (a, b) => collator.compare(artistKey(a.song), artistKey(b.song)) || byTitle(a.song, b.song),
  title: (a, b) => byTitle(a.song, b.song),
  newest: (a, b) => (b.song.added || '').localeCompare(a.song.added || '') || b.index - a.index,
  key: (a, b) => numeric(keyRank, a.song, b.song) || byTitle(a.song, b.song),
  tempo: (a, b) => numeric((s) => (Number.isFinite(s.bpm) ? s.bpm : null), a.song, b.song) || byTitle(a.song, b.song),
  length: (a, b) => numeric((s) => parseDuration(s.duration), a.song, b.song) || byTitle(a.song, b.song),
};

/** The rows in `mode` order (an unknown mode falls back to the default); the input is left alone. */
export function sortSongs(songs, mode = DEFAULT_SORT) {
  const compare = COMPARE[SORTS.includes(mode) ? mode : DEFAULT_SORT];
  return songs
    .map((song, index) => ({ song, index }))
    .sort(compare)
    .map((row) => row.song);
}

/**
 * Runs of the same label as groups [{ label, songs }]: artist and key order
 * group, the others do not, and a single group carries no heading (label null).
 */
export function groupSongs(sorted, mode, labelFor) {
  if (mode !== 'artist' && mode !== 'key') return [{ label: null, songs: sorted }];
  const groups = [];
  for (const song of sorted) {
    const label = labelFor(song, mode);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.songs.push(song);
    else groups.push({ label, songs: [song] });
  }
  return groups.length > 1 ? groups : [{ label: null, songs: sorted }];
}
