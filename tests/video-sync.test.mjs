import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarClock } from '../js/video-sync.js';

test('BarClock maps times to bars with fractions', () => {
  const clock = new BarClock([1, 3, 5, 7], { bpm: 120, timeSignature: [4, 4] });
  assert.deepEqual(clock.timeToBar(0.5), { bar: 0, frac: 0, before: true, after: false });
  assert.deepEqual(clock.timeToBar(1), { bar: 0, frac: 0, before: false, after: false });
  assert.deepEqual(clock.timeToBar(4), { bar: 1, frac: 0.5, before: false, after: false });
  assert.equal(clock.timeToBar(8).bar, 3);
  assert.equal(clock.timeToBar(8).frac, 0.5);
  assert.equal(clock.timeToBar(40).frac, 1);
  assert.equal(clock.end, 9);
});

test('BarClock converts bars back to time', () => {
  const clock = new BarClock([1, 3, 5, 7], { bpm: 120 });
  assert.equal(clock.barToTime(0), 1);
  assert.equal(clock.barToTime(2, 0.5), 6);
  assert.equal(clock.barToTime(3, 1), 9);
  assert.equal(clock.barToTime(99), 7);
});
