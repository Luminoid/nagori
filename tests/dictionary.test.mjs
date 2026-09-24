// The chord dictionary and the fretboard deep link: key parsing, tuning lookup, entries and strum notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, tuningFor } from '../js/theory.js';
import { QUALITIES, dictionaryEntry, voicingMidi, parseChordName } from '../js/chord-library.js';
import { dictionaries } from '../js/i18n.js';

test('parseKey reads the keys songs are written in', () => {
  assert.deepEqual(parseKey('C minor'), { root: 0, scale: 'minor', flats: false });
  assert.deepEqual(parseKey('G# minor'), { root: 8, scale: 'minor', flats: false });
  assert.deepEqual(parseKey('Bb'), { root: 10, scale: 'major', flats: true });
  assert.deepEqual(parseKey('D major'), { root: 2, scale: 'major', flats: false });
  assert.deepEqual(parseKey('F♯ minor'), { root: 6, scale: 'minor', flats: false });
  assert.deepEqual(parseKey('Am'), { root: 9, scale: 'minor', flats: false });
  assert.equal(parseKey(''), null);
  assert.equal(parseKey(undefined), null);
  assert.equal(parseKey('D dorian'), null);
});

test('tuningFor maps a track tuning to a tools-page tuning', () => {
  assert.equal(tuningFor([64, 59, 55, 50, 45, 40]).id, 'standard');
  assert.equal(tuningFor([64, 59, 55, 50, 45, 38]).id, 'dropD');
  assert.equal(tuningFor([62, 57, 55, 50, 45, 38]).id, 'dadgad');
  assert.equal(tuningFor([43, 38, 33, 28]).id, 'bass');
  assert.equal(tuningFor([64, 59, 55, 50, 45, 33]), null);
  assert.equal(tuningFor(undefined), null);
});

test('every root has the common qualities, under the chosen spelling', () => {
  for (let pc = 0; pc < 12; pc++) {
    for (const suffix of ['', 'm', '7', 'm7', 'sus4', '5']) {
      const entry = dictionaryEntry(pc, suffix);
      assert.ok(entry.voicings.length >= 1, `${entry.name} has no voicing`);
    }
  }
  assert.equal(dictionaryEntry(0, '').name, 'C');
  assert.equal(dictionaryEntry(0, '').voicings[0].frets, 'x32010');
  assert.equal(dictionaryEntry(10, 'm', { flats: true }).name, 'Bbm');
  assert.equal(dictionaryEntry(1, '', { flats: true }).name, 'Db');
  assert.equal(dictionaryEntry(1, '').name, 'C#');
  assert.equal(dictionaryEntry(13, '').name, 'C#');
  assert.deepEqual(dictionaryEntry(0, 'sus2').voicings, [], 'sus2 exists only as open shapes');
  assert.equal(new Set(QUALITIES.map((q) => q.suffix)).size, QUALITIES.length);
  for (const q of QUALITIES) assert.ok(dictionaries.en[q.label] && dictionaries.zh[q.label], q.label);
});

test('voicingMidi strums low to high and skips muted strings', () => {
  assert.deepEqual(voicingMidi('x32010'), [48, 52, 55, 60, 64]);
  assert.deepEqual(voicingMidi('8 10 10 8 8 8'), [48, 55, 60, 63, 67, 72]);
  assert.deepEqual(voicingMidi('022xxx'), [40, 47, 52]);
});

test('parseChordName reads the names chord cards carry', () => {
  assert.deepEqual(parseChordName('Bbm7'), { root: 10, suffix: 'm7', flats: true });
  assert.deepEqual(parseChordName('F♯'), { root: 6, suffix: '', flats: false });
  assert.deepEqual(parseChordName('Dm/F'), { root: 2, suffix: 'm', flats: false });
  assert.deepEqual(parseChordName('A♭maj7'), { root: 8, suffix: 'maj7', flats: true });
  assert.equal(parseChordName('nope'), null);
  assert.equal(parseChordName(null), null);
});
