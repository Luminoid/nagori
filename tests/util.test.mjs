import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringNames } from '../js/util.js';
import { layoutTrack, renderSystem } from '../js/tab-renderer.js';

test('stringNames derives tab labels from MIDI tuning', () => {
  assert.deepEqual(stringNames([64, 59, 55, 50, 45, 40]), ['e', 'B', 'G', 'D', 'A', 'E']);
  assert.deepEqual(stringNames([64, 59, 55, 50, 45, 38]), ['E', 'B', 'G', 'D', 'A', 'D']);
  assert.deepEqual(stringNames([64, 59, 54, 50, 45, 38]), ['E', 'B', 'F♯', 'D', 'A', 'D']);
  assert.deepEqual(stringNames([43, 38, 33, 28]), ['G', 'D', 'A', 'E']);
});

test('time signature changes get a label and extra room', () => {
  const q = { d: [1, 4], t: 4, notes: [{ s: 0, f: 1 }] };
  const e = { d: [1, 8], t: 8, notes: [{ s: 0, f: 1 }] };
  const track = {
    strings: 6,
    tuning: [64, 59, 55, 50, 45, 38],
    measures: [
      { beats: [q, q, q, q], sig: [4, 4] },
      { beats: [e, e, e, e, e, e, e], sig: [7, 8] },
      { beats: [e, e, e, e, e, e, e], sig: [7, 8] },
    ],
  };
  const [system] = layoutTrack(track, 900);
  assert.deepEqual(system.measures.map((m) => m.sig), [[4, 4], [7, 8], null]);
  const svg = renderSystem(system, track, { lastBar: 2 });
  assert.equal((svg.match(/class="time-sig"/g) || []).length, 4);
  assert.match(svg, /class="string-name"[^>]*>D</);
});
