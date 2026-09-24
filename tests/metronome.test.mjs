import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeContext } from './helpers/fake-audio.mjs';

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 5);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { Metronome, TapTempo } = await import('../js/metronome.js');

test('Metronome schedules accented clicks ahead of the clock and reports them on time', () => {
  const ctx = new FakeContext();
  const metro = new Metronome({ createContext: () => ctx });
  metro.setBpm(120);
  metro.setBeats(3);
  const ticks = [];
  metro.addEventListener('tick', (e) => ticks.push(e.detail));
  metro.start();
  assert.equal(metro.running, true);
  assert.equal(ctx.sources.length, 1); // 0.08 s is inside the lookahead, 0.58 s is not
  assert.ok(Math.abs(ctx.sources[0].startAt - 0.08) < 1e-9);
  assert.equal(ctx.gains.at(-1).gain.value, 1); // accent
  ctx.currentTime = 0.5;
  metro.schedule();
  assert.equal(ctx.sources.length, 2);
  assert.ok(Math.abs(ctx.sources[1].startAt - 0.58) < 1e-9);
  assert.equal(ctx.gains.at(-1).gain.value, 0.7); // plain beat
  ctx.currentTime = 0.6;
  metro.flush();
  assert.deepEqual(ticks.map((x) => [x.beat, x.sub, x.kind]), [[0, 0, 'accent'], [1, 0, 'beat']]);
  metro.setSubdivision(2);
  ctx.currentTime = 1.0;
  metro.schedule();
  assert.equal(ctx.sources.length, 3);
  assert.deepEqual([metro.queue[0].beat, metro.queue[0].sub], [2, 0]);
  ctx.currentTime = 1.2;
  metro.schedule(); // 1.33 is the first subdivision click
  assert.equal(metro.queue.at(-1).kind, 'sub');
  metro.stop();
  assert.equal(metro.running, false);
  assert.deepEqual(metro.queue, []);
});

test('Metronome wraps beats and clamps the tempo', () => {
  const ctx = new FakeContext();
  const metro = new Metronome({ createContext: () => ctx });
  metro.setBpm(1000);
  assert.equal(metro.bpm, 300);
  metro.setBpm(5);
  assert.equal(metro.bpm, 20);
  metro.setBpm(240);
  metro.setBeats(2);
  metro.setAccent(false);
  metro.start();
  ctx.currentTime = 1;
  metro.schedule();
  const beats = metro.queue.map((x) => x.beat);
  assert.deepEqual(beats.slice(0, 4), [0, 1, 0, 1]);
  assert.ok(metro.queue.every((x) => x.kind === 'beat'));
  metro.stop();
});

test('TapTempo averages the last taps and resets after a pause', () => {
  const taps = new TapTempo();
  assert.equal(taps.tap(0), null);
  assert.equal(taps.tap(500), 120);
  assert.equal(taps.tap(1000), 120);
  assert.equal(taps.tap(1600), 112); // 1600 / 3 intervals
  assert.equal(taps.tap(10000), null); // too long since the last tap
  assert.equal(taps.tap(10400), 150);
});
