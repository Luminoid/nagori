import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoicing, voicingToShape, voicingSVG, baseFretFor } from '../js/chord-diagram.js';
import { formatChord, chordKey, formatBarList } from '../js/util.js';

test('parseVoicing handles compact and spaced forms', () => {
  assert.deepEqual(parseVoicing('x35543'), [null, 3, 5, 5, 4, 3]);
  assert.deepEqual(parseVoicing('x 10 12 12 11 10'), [null, 10, 12, 12, 11, 10]);
});

test('voicingToShape maps low-to-high frets onto tab string indices', () => {
  const shape = voicingToShape(parseVoicing('x02210'), parseVoicing('x02310'), 6);
  assert.deepEqual(shape.mutes, [5]);
  assert.deepEqual(shape.opens.sort(), [0, 4]);
  assert.deepEqual(shape.notes.map((n) => [n.s, n.f, n.finger]), [[3, 2, 2], [2, 2, 3], [1, 1, 1]]);
});

test('baseFretFor shows the nut for low shapes and shifts for high ones', () => {
  assert.equal(baseFretFor([{ f: 2 }, { f: 3 }]), 1);
  assert.equal(baseFretFor([{ f: 8 }, { f: 10 }]), 8);
  assert.equal(baseFretFor([{ f: 3 }, { f: 8 }]), 3);
});

test('voicingSVG renders a barre, dots and finger labels', () => {
  const svg = voicingSVG({ frets: '133211', fingers: '134211' }, 6, 'F');
  assert.match(svg, /class="barre"/);
  assert.match(svg, /class="nut"/);
  assert.equal((svg.match(/class="dot"/g) || []).length, 6);
  assert.match(svg, /class="dot-label"[^>]*>4</);
});

test('chord name formatting and keys', () => {
  assert.equal(formatChord('Bb6'), 'B♭6');
  assert.equal(formatChord('Abmaj7/Eb'), 'A♭maj7/E♭');
  assert.equal(formatChord('C#m'), 'C♯m');
  assert.equal(chordKey('A♭maj7/E♭'), 'Abmaj7/Eb');
  assert.equal(formatBarList([1, 2, 3, 12, 23, 24]), '1–3, 12, 23–24');
});
