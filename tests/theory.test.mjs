import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteName, noteLabel, octaveOf, midiToFreq, TUNINGS, inScale, fretboardNotes } from '../js/theory.js';
import { fretPositions, fretboardSVG } from '../js/fretboard.js';

const STANDARD = TUNINGS[0].midi;

test('note names, octaves and frequencies', () => {
  assert.equal(noteName(64), 'E');
  assert.equal(noteName(61), 'C♯');
  assert.equal(noteName(61, { flats: true }), 'D♭');
  assert.equal(octaveOf(60), 4);
  assert.equal(noteLabel(40), 'E2');
  assert.equal(noteLabel(64), 'E4');
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFreq(40) - 82.4069) < 1e-3);
});

test('fretboardNotes lays out standard tuning', () => {
  const rows = fretboardNotes(STANDARD, 12);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].length, 13);
  assert.deepEqual(rows.map((r) => noteName(r[0].midi)), ['E', 'B', 'G', 'D', 'A', 'E']);
  assert.equal(noteName(rows[5][5].midi), 'A'); // low E, fret 5
  assert.equal(noteName(rows[4][7].midi), 'E'); // A string, fret 7
  assert.equal(rows[0][12].midi, 76);
});

test('scales', () => {
  assert.equal(inScale(4, 0, 'major'), true);
  assert.equal(inScale(1, 0, 'major'), false);
  assert.equal(inScale(3, 0, 'minorPent'), true);
  assert.equal(inScale(11, 9, 'minor'), true); // B in A minor
  assert.equal(inScale(1, null, 'major'), true); // no root: everything shows
});

test('fret positions narrow up the neck and the chart marks the root', () => {
  const xs = fretPositions(12, 100);
  assert.equal(xs[0], 0);
  assert.ok(Math.abs(xs[12] - 100) < 1e-9);
  for (let n = 2; n <= 12; n++) assert.ok(xs[n] - xs[n - 1] < xs[n - 1] - xs[n - 2]);
  const svg = fretboardSVG({ tuning: STANDARD, frets: 15, root: 4, scale: 'minorPent' });
  assert.equal((svg.match(/data-midi=/g) || []).length, 6 * 16);
  assert.equal((svg.match(/class="fb-note is-root"/g) || []).length, 9); // every E up to fret 15
  assert.ok(svg.includes('class="fb-note off"'));
  const plain = fretboardSVG({ tuning: STANDARD, frets: 12, flats: true });
  assert.ok(plain.includes('>B♭<') && !plain.includes('is-root'));
});

test('a key may carry a note in parentheses after it', async () => {
  const { parseKey } = await import('../js/theory.js');
  assert.deepEqual(parseKey('A♭ minor (G minor shapes, capo 1)'), { root: 8, scale: 'minor', flats: true });
  assert.deepEqual(parseKey('E'), { root: 4, scale: 'major', flats: false });
  assert.equal(parseKey('E ('), null);
  assert.equal(parseKey('(capo 1) E'), null);
});
