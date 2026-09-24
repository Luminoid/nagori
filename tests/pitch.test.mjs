import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, nearestNote } from '../js/pitch.js';

function tone(freq, sampleRate, n, harmonics = []) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (2 * Math.PI * freq * i) / sampleRate;
    out[i] = 0.5 * Math.sin(phase);
    harmonics.forEach((amp, k) => {
      out[i] += amp * Math.sin(phase * (k + 2));
    });
  }
  return out;
}

test('detectPitch finds the fundamental of plain and rich tones', () => {
  const sr = 44100;
  const low = detectPitch(tone(110, sr, 4096), sr);
  assert.ok(low && Math.abs(low.freq - 110) < 0.3, `got ${low && low.freq}`);
  const rich = detectPitch(tone(196, sr, 4096, [0.6, 0.3, 0.2]), sr);
  assert.ok(rich && Math.abs(rich.freq - 196) < 0.5, `got ${rich && rich.freq}`);
  const high = detectPitch(tone(659.26, sr, 2048, [0.4]), sr);
  assert.ok(high && Math.abs(high.freq - 659.26) < 1.5, `got ${high && high.freq}`);
  assert.ok(rich.clarity > 0.9);
});

test('detectPitch ignores silence and noise', () => {
  const sr = 44100;
  assert.equal(detectPitch(new Float32Array(2048), sr), null);
  let seed = 1;
  const noise = Float32Array.from({ length: 4096 }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 0.6 - 0.3;
  });
  const result = detectPitch(noise, sr);
  assert.ok(result === null || result.clarity < 0.9);
});

test('nearestNote gives the note and the cents away from it', () => {
  assert.deepEqual(nearestNote(440), { midi: 69, cents: 0 });
  const sharp = nearestNote(446);
  assert.equal(sharp.midi, 69);
  assert.ok(Math.abs(sharp.cents - 23.4) < 0.2);
  const flat = nearestNote(81);
  assert.equal(flat.midi, 40);
  assert.ok(flat.cents < 0 && flat.cents > -50);
});
