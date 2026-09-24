#!/usr/bin/env node
// Propose chord-library entries from the shapes a track actually plays:
// for every chord label, the most-used solver shape becomes a voicing.
//
//   node scripts/propose-library.mjs <songId> <trackId> [minBars]

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeTrack, positionsBySection, fingerString } from '../js/fingering.js';
import { chordKey } from '../js/util.js';
import { libraryFor } from '../js/chord-library.js';

const [songId, trackId, minBarsArg] = process.argv.slice(2);
if (!songId || !trackId) {
  console.error('usage: propose-library.mjs <song> <track id> [minBars]');
  process.exit(1);
}
const minBars = Number(minBarsArg || 2);
const base = ['data/songs', 'private/songs'].map((dir) => new URL(`../${dir}/${songId}/`, import.meta.url)).find((url) => existsSync(url)) || new URL(`../data/songs/${songId}/`, import.meta.url);
const song = JSON.parse(await readFile(new URL('song.json', base), 'utf8'));
const meta = song.tracks.find((t) => t.id === trackId);
const track = JSON.parse(await readFile(new URL(meta.file, base), 'utf8'));
track.id = meta.id;
const analysis = analyzeTrack(track, { library: {}, overrides: {}, chordTimeline: song.chordTimeline, trackId, ...(meta.fingering?.maxSpan ? { maxSpan: meta.fingering.maxSpan } : {}) });
const byChord = new Map();
for (const section of positionsBySection(analysis, song.sections, song.bars, track.strings)) {
  for (const card of section.cards) {
    if (!card.chord || card.labels.length > 1 || card.shape.notes.length < 2) continue;
    const key = chordKey(card.chord);
    const frets = [];
    const fingers = [];
    for (let s = track.strings - 1; s >= 0; s--) {
      const note = card.shape.notes.find((n) => n.s === s);
      if (note) {
        frets.push(String(note.f));
        fingers.push(String(note.finger || '?'));
      } else if (card.shape.opens.includes(s)) {
        frets.push('0');
        fingers.push('0');
      } else {
        frets.push('x');
        fingers.push('x');
      }
    }
    const spaced = frets.some((f) => f.length > 1);
    const entry = { frets: spaced ? frets.join(' ') : frets.join(''), fingers: spaced ? fingers.join(' ') : fingers.join(''), bars: card.bars.length };
    const list = byChord.get(key) || [];
    const existing = list.find((e) => e.frets === entry.frets);
    if (existing) existing.bars += entry.bars;
    else list.push(entry);
    byChord.set(key, list);
  }
}
const out = {};
for (const [chord, list] of byChord) {
  list.sort((a, b) => b.bars - a.bars);
  const keep = list.filter((e) => e.bars >= minBars).slice(0, 2);
  if (!keep.length) continue;
  out[chord] = keep.length === 1 ? { frets: keep[0].frets, fingers: keep[0].fingers } : keep.map((e) => ({ frets: e.frets, fingers: e.fingers }));
  console.error(`${chord.padEnd(8)} ${list.map((e) => `${e.frets} (${e.fingers}) ×${e.bars}`).join(' | ')}`);
}
console.log(JSON.stringify(out, null, 2));
