#!/usr/bin/env node
// Render a song's tab playback to a mono 16-bit WAV with the site's synthesis
// (no pitch effects, no compressor; peak-normalized).
//
//   node scripts/render-audio.mjs <song> [fromBar] [toBar] [out.wav] [--out file.wav] [--mute id,id] [--sound auto|overdrive|...] [--rate 44100]
//
// Bars are 1-based and inclusive. Example: make render SONG=tarrega-lagrima FROM=1 TO=8

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tabClock, buildEvents, renderOffline, SOUNDS } from '../js/tab-audio.js';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i];
  else positional.push(args[i]);
}
const [slug, fromArg, toArg, positionalOut] = positional;
const outArg = flags.out || positionalOut;
if (!slug) {
  console.error('usage: render-audio.mjs <song> [fromBar] [toBar] [out.wav] [--out file.wav] [--mute id,id] [--sound name] [--rate 44100]');
  process.exit(1);
}
const sound = flags.sound || 'auto'; // auto: each part's own sound from the song data
if (sound !== 'auto' && !SOUNDS[sound]) {
  console.error(`unknown sound "${sound}"; one of auto, ${Object.keys(SOUNDS).join(', ')}`);
  process.exit(1);
}

const base = ['data/songs', 'private/songs'].map((dir) => new URL(`../${dir}/${slug}/`, import.meta.url)).find((url) => existsSync(url)) || new URL(`../data/songs/${slug}/`, import.meta.url);
const song = JSON.parse(await readFile(new URL('song.json', base), 'utf8'));
// The same per-part settings the page passes to its player: each part's own sound and starting level.
const tracks = await Promise.all(
  song.tracks.map(async (meta) => ({ ...JSON.parse(await readFile(new URL(meta.file, base), 'utf8')), id: meta.id, kind: meta.kind, capo: meta.capo || 0, sound: meta.sound || null, level: meta.level })),
);
const clock = tabClock(song, tracks[0].measures, tracks.map((track) => track.measures));
const events = buildEvents(tracks, clock);
const fromBar = Math.max(1, Number(fromArg || 1));
const toBar = Math.min(song.bars, Number(toArg || song.bars));
if (!Number.isInteger(fromBar) || !Number.isInteger(toBar) || toBar < fromBar) {
  console.error(`bars must be whole numbers from 1 to ${song.bars}, first no later than last (got ${fromArg ?? 1} and ${toArg ?? song.bars})`);
  process.exit(1);
}
const sampleRate = Number(flags.rate || 44100);
const volumes = new Map(song.tracks.filter((meta) => meta.level !== undefined && meta.level !== null).map((meta) => [meta.id, meta.level]));
for (const id of (flags.mute || '').split(',').filter(Boolean)) volumes.set(id, 0);
const from = clock.barToTime(fromBar - 1);
const to = clock.barToTime(toBar - 1, 1) + 1.5;
const mix = renderOffline(events, sampleRate, { from, to, volumes, sound });

let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
const scale = peak > 0 ? 0.89 / peak : 1;
const pcm = new Int16Array(mix.length);
for (let i = 0; i < mix.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, mix[i] * scale)) * 32767);

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.byteLength, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.byteLength, 40);
const out = outArg || `${slug}-${fromBar}-${toBar}.wav`;
await writeFile(out, Buffer.concat([header, Buffer.from(pcm.buffer)]));
console.log(`${out}: bars ${fromBar}-${toBar}, ${(to - from).toFixed(1)} s, ${events.length} notes in the song${volumes.size ? `, muted ${[...volumes.keys()].join(', ')}` : ''}`);
