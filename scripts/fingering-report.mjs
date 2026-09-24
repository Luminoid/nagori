#!/usr/bin/env node
// Print every position (segment) the fingering analyzer finds for a track,
// grouped by section, so curated overrides can be reviewed offline.
//
//   node scripts/fingering-report.mjs tarrega-lagrima [trackId]

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeTrack, positionsBySection, fingerString } from '../js/fingering.js';
import { stringNames } from '../js/util.js';
import { libraryFor } from '../js/chord-library.js';

const [songId = 'tarrega-lagrima', onlyTrack] = process.argv.slice(2);
const base = ['data/songs', 'private/songs'].map((dir) => new URL(`../${dir}/${songId}/`, import.meta.url)).find((url) => existsSync(url)) || new URL(`../data/songs/${songId}/`, import.meta.url);
const song = JSON.parse(await readFile(new URL('song.json', base), 'utf8'));

for (const meta of song.tracks) {
  if (onlyTrack && meta.id !== onlyTrack) continue;
  const track = JSON.parse(await readFile(new URL(meta.file, base), 'utf8'));
  track.id = meta.id;
  const analysis = analyzeTrack(track, { library: libraryFor(song, meta), overrides: song.fingeringOverrides, chordTimeline: song.chordTimeline, trackId: meta.id, ...(meta.fingering?.maxSpan ? { maxSpan: meta.fingering.maxSpan } : {}) });
  const names = stringNames(track.tuning);
  console.log(`\n=== ${meta.id} (${meta.name}, ${meta.role}) — ${analysis.segments.length} positions ===`);
  for (const section of positionsBySection(analysis, song.sections, song.bars, track.strings)) {
    console.log(`-- ${section.name} (bars ${section.startBar + 1}-${section.endBar + 1})`);
    for (const card of section.cards) {
      const notes = card.shape.notes
        .filter((n) => n.played !== false)
        .map((n) => `${names[n.s]}${n.f}→${n.finger ?? '?'}`)
        .join(' ');
      const barre = card.shape.barre ? ` barre@${card.shape.barre.fret}` : '';
      console.log(`   ${(card.labels.length > 1 && card.source !== 'library' ? `${card.labels[0]}→${card.labels[card.labels.length - 1]}` : card.chord || '(no chord)').padEnd(11)} ${card.kind.padEnd(6)} ${(card.shapeName ? `${card.source}:${card.shapeName}` : card.source).padEnd(12)} ${fingerString(card.shape).padEnd(7)} ${notes}${barre}  bars ${card.bars.join(',')}`);
    }
  }
}
