import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTrack, renderSystem, beatIndexAt, beatFractions, beatWidth } from '../js/tab-renderer.js';

function measure(beats, extra = {}) {
  return { beats, ...extra };
}
const q = (notes, extra = {}) => ({ d: [1, 4], t: 4, notes, ...extra });
const e = (notes, extra = {}) => ({ d: [1, 8], t: 8, notes, ...extra });

test('beatWidth grows with duration but not linearly', () => {
  const eighth = beatWidth(e([]));
  const quarter = beatWidth(q([]));
  const whole = beatWidth({ d: [1, 1], t: 1, notes: [] });
  assert.ok(quarter > eighth);
  assert.ok(whole > quarter);
  assert.ok(whole < eighth * 8);
});

test('beatFractions and beatIndexAt follow cumulative durations', () => {
  const m = measure([q([]), e([]), e([]), q([]), q([])]);
  assert.deepEqual(beatFractions(m), [0, 0.25, 0.375, 0.5, 0.75]);
  assert.equal(beatIndexAt(m, 0), 0);
  assert.equal(beatIndexAt(m, 0.3), 1);
  assert.equal(beatIndexAt(m, 0.99), 4);
  assert.equal(beatIndexAt(m, 1), 4);
});

test('layoutTrack packs measures into systems that fill the width', () => {
  const bars = Array.from({ length: 12 }, (_, i) => measure([q([{ s: 5, f: i }]), q([]), q([]), q([])], i === 0 ? { marker: 'Intro' } : {}));
  const systems = layoutTrack({ strings: 6, measures: bars }, 800);
  assert.ok(systems.length >= 2);
  const total = systems.reduce((n, s) => n + s.measures.length, 0);
  assert.equal(total, 12);
  for (const system of systems.slice(0, -1)) {
    const last = system.measures[system.measures.length - 1];
    assert.ok(Math.abs(last.x + last.width - 800) < 0.5, 'full systems end at the right edge');
  }
  assert.equal(systems[0].firstBar, 0);
});

test('renderSystem emits fret numbers, finger digits, chord names, markers and a cursor', () => {
  const track = {
    strings: 6,
    measures: [
      measure([e([{ s: 5, f: 8 }], { chord: 'Cm', ring: true, bs: true }), e([{ s: 2, f: 8 }], { ring: true, be: true }), q([{ s: 1, f: 8, tie: true }]), q([], { rest: true })], { marker: 'Verse 1' }),
      measure([q([{ s: 0, f: 3, dead: true }]), q([{ s: 0, f: 5, slide: 'up' }]), q([{ s: 0, f: 7, hp: true }]), q([{ s: 0, f: 9, bend: 0.5 }])]),
    ],
  };
  const [system] = layoutTrack(track, 600);
  const svg = renderSystem(system, track, { fingerFor: () => 1, lastBar: 1 });
  assert.match(svg, /<svg class="tab-svg"/);
  assert.match(svg, /class="marker"[^>]*>Verse 1</);
  assert.match(svg, /class="chord-name"[^>]*>Cm</);
  assert.match(svg, /class="fret"[^>]*>8</);
  assert.match(svg, /class="fret tied"[^>]*>\(8\)</);
  assert.match(svg, /class="fret dead"[^>]*>x</);
  assert.match(svg, /class="finger"/);
  assert.match(svg, /class="beam"/);
  assert.match(svg, /class="tie"/);
  assert.match(svg, /class="slur"/);
  assert.match(svg, /class="bend"/);
  assert.match(svg, /class="ring-label"[^>]*>let ring</);
  assert.match(svg, /data-cursor/);
  assert.equal((svg.match(/class="measure-hit"/g) || []).length, 2);
  assert.match(svg, /class="barline final"/);
});
