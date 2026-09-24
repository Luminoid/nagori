// The built-in chord library: every voicing is playable, the usual shapes are
// there under both spellings, and songs' own voicings come first when merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLibrary, libraryFor, STANDARD_TUNING } from '../js/chord-library.js';
import { voicingProblem, analyzeTrack } from '../js/fingering.js';

test('every built-in voicing has a playable fingering', () => {
  const library = sharedLibrary(STANDARD_TUNING);
  const problems = [];
  let count = 0;
  for (const [name, list] of Object.entries(library)) {
    for (const v of list) {
      count++;
      const problem = voicingProblem(v.frets, v.fingers);
      if (problem) problems.push(`${name} ${v.frets}/${v.fingers}: ${problem}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(count > 200, `${count} voicings`);
});

test('open chords and barre shapes are there under sharp and flat spellings', () => {
  const library = sharedLibrary(STANDARD_TUNING);
  assert.equal(library.C[0].frets, 'x32010');
  assert.equal(library.F[0].frets, '133211');
  assert.equal(library.Bm[0].frets, 'x24432');
  assert.equal(library.Bb[0].frets, 'x13331');
  assert.equal(library['A#'][0].frets, 'x13331');
  assert.deepEqual(library.G.map((v) => v.frets), ['320003', '355433', 'x 10 12 12 12 10']);
  assert.equal(library['F#m7'][0].frets, '242222');
  assert.ok(!library.E.some((v) => v.frets === '12 14 14 13 12 12'), 'no shape doubles an open chord at the 12th fret');
});

test('only standard six-string tuning has a built-in library', () => {
  assert.deepEqual(sharedLibrary([43, 38, 33, 28]), {});
  assert.deepEqual(sharedLibrary([64, 59, 55, 50, 45, 38]), {});
  assert.deepEqual(sharedLibrary(null), {});
});

test('libraryFor layers part, song and built-in voicings, curated first', () => {
  const song = { chordLibrary: { 'B♭': { frets: 'x1333x', fingers: 'x1234x' }, Em: { frets: '022000', fingers: '012000' } }, tracks: [{ kind: 'guitar', tuning: STANDARD_TUNING }] };
  const track = { tuning: STANDARD_TUNING, chordLibrary: { Em: { frets: '079980', fingers: '012340' } } };
  const merged = libraryFor(song, track);
  assert.deepEqual(merged.Em.map((v) => v.frets), ['079980', '022000', 'x79987']);
  assert.deepEqual(merged.Bb.map((v) => v.frets), ['x1333x', 'x13331', '688766']);
  assert.equal(merged.C[0].frets, 'x32010');
  const bass = libraryFor(song, { tuning: [43, 38, 33, 28] });
  assert.equal(bass.C, undefined);
  assert.deepEqual(bass.Em.map((v) => v.frets), ['022000']);
});

test('a song with no library of its own is fingered from the built-in chords', () => {
  const beat = (notes, extra = {}) => ({ d: [1, 4], t: 4, notes: notes.map(([s, f]) => ({ s, f })), ...extra });
  const track = { id: 't', strings: 6, tuning: STANDARD_TUNING, measures: [{ beats: [beat([[5, 1], [4, 3], [3, 3], [2, 2], [1, 1], [0, 1]], { chord: 'F', ring: true })] }] };
  const analysis = analyzeTrack(track, { library: libraryFor({}, track) });
  assert.equal(analysis.segments[0].source, 'library');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => analysis.fingerFor(0, 0, i)), [1, 3, 4, 2, 1, 1]);
});

test('the diminished, augmented and sixth shapes sound their chords for every root', async () => {
  const { dictionaryEntry, voicingMidi, QUALITIES } = await import('../js/chord-library.js');
  const intervals = { dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9] };
  for (const suffix of Object.keys(intervals)) {
    assert.ok(QUALITIES.some((q) => q.suffix === suffix), `${suffix} is in the dictionary`);
    let roots = 0;
    for (let pc = 0; pc < 12; pc++) {
      const { name, voicings } = dictionaryEntry(pc, suffix);
      if (!voicings.length) continue;
      roots += 1;
      for (const voicing of voicings) {
        const classes = new Set(voicingMidi(voicing.frets).map((m) => (m - pc + 120) % 12));
        assert.ok(classes.has(0), `${name} ${voicing.frets} sounds its root`);
        assert.ok(classes.size >= 3, `${name} ${voicing.frets} has three or more notes`);
        for (const c of classes) assert.ok(intervals[suffix].includes(c), `${name} ${voicing.frets}: interval ${c} is not in a ${suffix} chord`);
      }
    }
    assert.ok(roots >= 11, `${suffix} shapes exist for ${roots} roots`);
  }
  assert.ok(dictionaryEntry(1, 'dim7').voicings.length >= 1, 'C#dim7 (Prelude BWV 999) has a diagram');
  assert.ok(dictionaryEntry(10, '6', { flats: true }).voicings.length >= 1, 'Bb6 has a diagram');
});
