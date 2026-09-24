import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveShape, solveMelody, analyzeTrack, positionsBySection, voicingProblem } from '../js/fingering.js';
import { parseVoicing } from '../js/chord-diagram.js';

// Build { notes, opens } from a low-to-high voicing string.
function shapeOf(voicing, strings = 6) {
  const frets = parseVoicing(voicing);
  const notes = [];
  const opens = new Set();
  frets.forEach((f, i) => {
    const s = strings - 1 - i;
    if (f === null) return;
    if (f === 0) opens.add(s);
    else notes.push({ s, f });
  });
  return { notes, opens };
}

function fingersLowToHigh(voicing, result, strings = 6) {
  const frets = parseVoicing(voicing);
  return frets.map((f, i) => {
    const s = strings - 1 - i;
    if (f === null) return 'x';
    if (f === 0) return 0;
    return result.fingers.get(`${s}:${f}`);
  }).join('');
}

const cases = [
  ['F major barre', '133211', '134211'],
  ['Bb barre', 'x13331', 'x12341'],
  ['Cm barre', 'x35543', 'x13421'],
  ['Gm barre', '355333', '134111'],
  ['Ab barre', '466544', '134211'],
  ['Am open', 'x02210', 'x02310'],
  ['D7 open', 'xx0212', 'xx0213'],
  ['Em6 (open G blocks a barre)', '022020', '012030'],
  ['Cm arpeggio: three barre notes only', '8xx88x', '1xx11x'],
];

for (const [name, voicing, expected] of cases) {
  test(`solveShape fingers ${name}`, () => {
    const { notes, opens } = shapeOf(voicing);
    const result = solveShape(notes, opens);
    assert.equal(fingersLowToHigh(voicing, result), expected);
  });
}

test('solveShape reports a barre only across three or more strings', () => {
  const full = solveShape(...Object.values(shapeOf('133211')));
  assert.deepEqual(full.barre, { fret: 1, from: 5, to: 0 });
  const two = solveShape(...Object.values(shapeOf('xx0030')));
  assert.equal(two.barre, null);
});

test('solveMelody uses one finger per fret from the lowest note', () => {
  const result = solveMelody([{ s: 1, f: 9 }, { s: 2, f: 12 }, { s: 3, f: 13 }]);
  assert.equal(result.fingers.get('1:9'), 1);
  assert.equal(result.fingers.get('2:12'), 4);
  assert.equal(result.fingers.get('3:13'), 4);
  assert.equal(result.baseFret, 9);
});

function beat(notes, extra = {}) {
  return { d: [1, 8], t: 8, notes: notes.map(([s, f]) => ({ s, f })), ...extra };
}

test('analyzeTrack splits positions on chord labels and uses the library when notes fit', () => {
  const track = {
    id: 't',
    strings: 6,
    measures: [
      { beats: [beat([[5, 8]], { chord: 'Cm', ring: true }), beat([[2, 8]], { ring: true }), beat([[1, 8]], { ring: true })] },
      { beats: [beat([[5, 6]], { chord: 'Bb6', ring: true }), beat([[2, 7]], { ring: true }), beat([[1, 8]], { ring: true })] },
    ],
  };
  const library = { Bb6: { frets: '6xx78x', fingers: '1xx23x' } };
  const analysis = analyzeTrack(track, { library });
  assert.equal(analysis.segments.length, 2);
  assert.equal(analysis.segments[0].source, 'solver');
  assert.deepEqual([analysis.fingerFor(0, 0, 0), analysis.fingerFor(0, 1, 0), analysis.fingerFor(0, 2, 0)], [1, 1, 1]);
  assert.equal(analysis.segments[1].source, 'library');
  assert.deepEqual([analysis.fingerFor(1, 0, 0), analysis.fingerFor(1, 1, 0), analysis.fingerFor(1, 2, 0)], [1, 2, 3]);
});

test('analyzeTrack labels positions from the song chord timeline when the track has no annotation', () => {
  const track = {
    id: 't',
    strings: 6,
    measures: [
      { beats: [beat([[5, 8]], { ring: true }), beat([[2, 8]], { ring: true })] },
      { beats: [beat([[5, 6]], { ring: true }), beat([[2, 7]], { ring: true })] },
    ],
  };
  const chordTimeline = [{ bar: 0, pos: 0, chord: 'Cm' }, { bar: 1, pos: 0, chord: 'B♭6' }];
  const analysis = analyzeTrack(track, { chordTimeline });
  assert.equal(analysis.segments.length, 2);
  assert.equal(analysis.segments[0].chord, 'Cm');
  assert.equal(analysis.segments[1].chord, 'B♭6');
});

test('analyzeTrack treats a strummed chord as a shape even without let-ring', () => {
  const track = { id: 't', strings: 6, measures: [{ beats: [beat([[5, 0], [4, 2], [3, 2], [2, 0], [1, 2]], { d: [1, 1], t: 1 })] }] };
  const analysis = analyzeTrack(track, {});
  assert.equal(analysis.segments[0].kind, 'shape');
  assert.deepEqual([analysis.fingerFor(0, 0, 1), analysis.fingerFor(0, 0, 2), analysis.fingerFor(0, 0, 4)], [1, 2, 3]);
  assert.equal(analysis.fingerFor(0, 0, 0), 0);
});

test('analyzeTrack applies overrides keyed by note set', () => {
  const track = { id: 't', strings: 6, measures: [{ beats: [beat([[4, 2], [3, 2], [1, 2]], { ring: true })] }] };
  const analysis = analyzeTrack(track, { overrides: { '4:2,3:2,1:2': { '4:2': 2, '3:2': 3, '1:2': 4 } } });
  assert.equal(analysis.segments[0].source, 'override');
  assert.deepEqual([analysis.fingerFor(0, 0, 0), analysis.fingerFor(0, 0, 1), analysis.fingerFor(0, 0, 2)], [2, 3, 4]);
});

test('positionsBySection groups by section and de-duplicates shapes', () => {
  const track = {
    id: 't',
    strings: 6,
    measures: [
      { beats: [beat([[5, 8]], { chord: 'Cm', ring: true })] },
      { beats: [beat([[5, 6]], { chord: 'Bb', ring: true })] },
      { beats: [beat([[5, 8]], { chord: 'Cm', ring: true })] },
      { beats: [beat([[5, 6]], { chord: 'Bb', ring: true })] },
    ],
  };
  const analysis = analyzeTrack(track, {});
  const sections = positionsBySection(analysis, [{ name: 'A', bar: 0 }, { name: 'B', bar: 2 }], 4, 6);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections[0].cards.map((c) => c.chord), ['Cm', 'Bb']);
  assert.deepEqual(sections[0].cards[0].bars, [1]);
  assert.deepEqual(sections[1].cards[1].bars, [4]);
});

test('positionsBySection hides single-note fragments unless nothing else is there', () => {
  const track = {
    id: 't',
    strings: 6,
    measures: [
      { beats: [beat([[5, 8], [2, 8]], { chord: 'Cm', ring: true })] },
      { beats: [beat([[0, 3]], { chord: 'Bb', ring: true })] },
      { beats: [beat([[0, 5]], { chord: 'G', ring: true })] },
    ],
  };
  const analysis = analyzeTrack(track, {});
  const [a, b] = positionsBySection(analysis, [{ name: 'A', bar: 0 }, { name: 'B', bar: 2 }], 3, 6);
  assert.deepEqual(a.cards.map((c) => c.chord), ['Cm']);
  assert.deepEqual(b.cards.map((c) => c.chord), ['G']);
});

// --- Hand position and passing notes -----------------------------------------

test('voicingProblem accepts real fingerings and rejects impossible ones', () => {
  assert.equal(voicingProblem('x35543', 'x13421'), null);
  assert.equal(voicingProblem('133211', '134211'), null);
  assert.equal(voicingProblem('022000', null), null);
  assert.match(voicingProblem('xxx654', 'xxx211'), /finger 1 on frets 5 and 4/);
  assert.match(voicingProblem('x32010', 'x3201'), /match/);
  assert.match(voicingProblem('x32010', 'x32011'), /open string/);
  assert.match(voicingProblem('x32010', 'x30010'), /no finger/);
});

test('every chord-library voicing in the song data has a playable fingering', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../data/songs/', import.meta.url);
  const problems = [];
  for (const slug of await readdir(root)) {
    const song = JSON.parse(await readFile(new URL(`${slug}/song.json`, root), 'utf8'));
    for (const [name, entry] of Object.entries(song.chordLibrary || {})) {
      for (const v of Array.isArray(entry) ? entry : [entry]) {
        const problem = voicingProblem(v.frets, v.fingers);
        if (problem) problems.push(`${slug} ${name} ${v.frets}/${v.fingers}: ${problem}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('a library match needs the chord to be held, not only passing notes beside it', () => {
  // Let Down: A x076xx is in the library, but the bar plays e2 and B3, both outside it.
  const track = { id: 't', strings: 6, measures: [{ beats: [beat([[0, 2]], { chord: 'A', ring: true }), beat([[1, 3]], { ring: true })] }] };
  const analysis = analyzeTrack(track, { library: { A: { frets: 'x076xx', fingers: 'x021xx' } } });
  assert.equal(analysis.segments[0].source, 'solver');
  assert.deepEqual([analysis.fingerFor(0, 0, 0), analysis.fingerFor(0, 1, 0)], [1, 2]);
});

test('a passing note beside a held chord takes a free finger inside the span', () => {
  // Em7 held (fingers 1, 2, 4), a G string note at fret 3 is picked meanwhile: the free ring finger.
  const library = { Em7: { frets: '022030', fingers: '012040' } };
  const held = { id: 't', strings: 6, measures: [{ beats: [beat([[4, 2], [3, 2], [1, 3]], { chord: 'Em7', ring: true }), beat([[2, 3]], { ring: true })] }] };
  const a = analyzeTrack(held, { library });
  assert.equal(a.segments[0].source, 'library');
  assert.equal(a.fingerFor(0, 1, 0), 3);
  // A note four frets above the chord's base cannot be reached while holding it: the solver takes over.
  const far = { id: 't', strings: 6, measures: [{ beats: [beat([[1, 3]], { chord: 'Em7', ring: true }), beat([[2, 6]], { ring: true })] }] };
  const b = analyzeTrack(far, { library });
  assert.equal(b.segments[0].source, 'solver');
  assert.deepEqual([b.fingerFor(0, 0, 0), b.fingerFor(0, 1, 0)], [1, 4]);
});

test('open-string playing below the fifth fret is fingered in first position', () => {
  const track = { id: 't', strings: 6, measures: [{ beats: [beat([[4, 2]]), beat([[4, 0]]), beat([[4, 4]]), beat([[3, 0]]), beat([[3, 3]])] }] };
  const analysis = analyzeTrack(track, {});
  assert.deepEqual([analysis.fingerFor(0, 0, 0), analysis.fingerFor(0, 2, 0), analysis.fingerFor(0, 4, 0)], [2, 4, 3]);
});

test('the hand stays in position when the next notes still fit under it', () => {
  const track = {
    id: 't',
    strings: 6,
    measures: [
      { beats: [beat([[1, 5]]), beat([[1, 7]]), beat([[0, 5]]), beat([[0, 8]])] },
      { beats: [beat([[0, 7]], { chord: 'X' }), beat([[0, 8]])] },
      { beats: [beat([[2, 9]], { chord: 'Y' }), beat([[2, 12]])] },
    ],
  };
  const analysis = analyzeTrack(track, {});
  assert.deepEqual([analysis.fingerFor(0, 0, 0), analysis.fingerFor(0, 1, 0), analysis.fingerFor(0, 3, 0)], [1, 3, 4]);
  assert.deepEqual([analysis.fingerFor(1, 0, 0), analysis.fingerFor(1, 1, 0)], [3, 4]);
  assert.deepEqual([analysis.fingerFor(2, 0, 0), analysis.fingerFor(2, 1, 0)], [1, 4]);
});

test('solveMelody and solveShape finger from an explicit hand position', () => {
  const melody = solveMelody([{ s: 0, f: 7 }, { s: 0, f: 8 }], { position: 5 });
  assert.deepEqual([melody.fingers.get('0:7'), melody.fingers.get('0:8')], [3, 4]);
  const { notes, opens } = shapeOf('022000');
  assert.equal(fingersLowToHigh('022000', solveShape(notes, opens, { position: 1 })), '023000');
});
