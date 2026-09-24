// The DSP toolkit behind the tab player and the offline renderer: biquads that match BiquadFilterNode, FFT convolution, the synthesized room and the modal body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { biquad, biquadMagnitude, filterSamples, filterChain, applyBiquad, fft, convolve, roomImpulse, noise, bodyImpulse, responseAt, disperse } from '../js/dsp.js';
import { FakeContext } from './helpers/fake-audio.mjs';

const dB = (x) => 20 * Math.log10(x);

test('biquad responses follow the RBJ cookbook', () => {
  const sr = 44100;
  const low = biquad('lowpass', 1000, sr, { Q: Math.SQRT1_2 });
  assert.ok(Math.abs(dB(biquadMagnitude(low, 1000, sr)) + 3) < 0.2, 'butterworth is -3 dB at the cutoff');
  assert.ok(dB(biquadMagnitude(low, 4000, sr)) < -22, 'and 12 dB per octave above');
  assert.ok(Math.abs(dB(biquadMagnitude(low, 50, sr))) < 0.05);
  const high = biquad('highpass', 100, sr);
  assert.ok(dB(biquadMagnitude(high, 25, sr)) < -22 && Math.abs(dB(biquadMagnitude(high, 2000, sr))) < 0.05);
  const peak = biquad('peaking', 105, sr, { Q: 2.5, gain: 5 });
  assert.ok(Math.abs(dB(biquadMagnitude(peak, 105, sr)) - 5) < 0.05, 'a peak reaches its gain at the centre');
  assert.ok(Math.abs(dB(biquadMagnitude(peak, 2000, sr))) < 0.1, 'and leaves the rest alone');
  const shelf = biquad('highshelf', 6500, sr, { gain: -4 });
  assert.ok(Math.abs(dB(biquadMagnitude(shelf, 20000, sr)) + 4) < 0.3 && Math.abs(dB(biquadMagnitude(shelf, 200, sr))) < 0.1);
  const lowShelf = biquad('lowshelf', 200, sr, { gain: 3 });
  assert.ok(Math.abs(dB(biquadMagnitude(lowShelf, 20, sr)) - 3) < 0.3);
  assert.throws(() => biquad('bandpass', 100, sr), /unknown biquad/);
});

test('filterSamples runs the filter the magnitude response describes', () => {
  const sr = 8000;
  const coeffs = biquad('lowpass', 500, sr);
  const n = 8000;
  const tone = (f) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));
  const rms = (s) => Math.sqrt(s.slice(4000).reduce((a, v) => a + v * v, 0) / 4000);
  assert.ok(Math.abs(rms(filterSamples(tone(100), coeffs)) / rms(tone(100)) - biquadMagnitude(coeffs, 100, sr)) < 0.01);
  assert.ok(Math.abs(rms(filterSamples(tone(2000), coeffs)) / rms(tone(2000)) - biquadMagnitude(coeffs, 2000, sr)) < 0.01);
  const chained = filterChain(tone(100), [{ type: 'lowpass', freq: 500 }, { type: 'highpass', freq: 50 }], sr);
  assert.equal(chained.length, n);
  assert.ok(chained.every(Number.isFinite));
});

test('applyBiquad hands the live node linear Q except for lowpass and highpass, which take dB', () => {
  const ctx = new FakeContext();
  const low = applyBiquad(ctx.createBiquadFilter(), { type: 'lowpass', freq: 3200, Q: 0.7 });
  assert.equal(low.type, 'lowpass');
  assert.equal(low.frequency.value, 3200);
  assert.ok(Math.abs(low.Q.value - 20 * Math.log10(0.7)) < 1e-9);
  const peak = applyBiquad(ctx.createBiquadFilter(), { type: 'peaking', freq: 105, Q: 2.5, gain: 5 });
  assert.equal(peak.Q.value, 2.5);
  assert.equal(peak.gain.value, 5);
});

test('fft round-trips and convolve matches direct convolution', () => {
  const n = 64;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + (i % 5) * 0.1);
  const im = new Float64Array(n);
  const copy = Float64Array.from(re);
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] - copy[i]) < 1e-9 && Math.abs(im[i]) < 1e-9);
  const rand = noise(5);
  const signal = Float32Array.from({ length: 5000 }, rand);
  const ir = Float32Array.from({ length: 300 }, (_, i) => rand() * Math.exp(-i / 60));
  const fast = convolve(signal, ir);
  const short = convolve(signal, ir.slice(0, 20));
  const direct = (h) => {
    const out = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) for (let k = 0; k < h.length && k <= i; k++) out[i] += signal[i - k] * h[k];
    return out;
  };
  const slow = direct(ir);
  const slowShort = direct(ir.slice(0, 20));
  let worst = 0;
  for (let i = 0; i < signal.length; i++) worst = Math.max(worst, Math.abs(fast[i] - slow[i]), Math.abs(short[i] - slowShort[i]));
  assert.ok(worst < 1e-4, `worst difference ${worst}`);
  assert.equal(fast.length, signal.length);
});

test('the room is a unit-energy response that decays and differs per channel', () => {
  const sr = 8000;
  const [left, right] = roomImpulse(sr, { seconds: 0.5, t60: 0.3 });
  assert.equal(left.length, 4000);
  const energy = (s, from, to) => s.slice(from, to).reduce((a, v) => a + v * v, 0);
  assert.ok(Math.abs(energy(left, 0, 4000) - 1) < 1e-3);
  assert.ok(energy(left, 0, 1000) > energy(left, 1000, 2000) * 5 && energy(left, 1000, 2000) > energy(left, 3000, 4000) * 5, 'decays');
  assert.notDeepEqual(Array.from(left.slice(500, 600)), Array.from(right.slice(500, 600)));
  assert.deepEqual(Array.from(roomImpulse(sr, { seconds: 0.5, t60: 0.3 })[0]), Array.from(left), 'deterministic');
});

test('a body is its direct radiation plus resonances that peak as specified and ring', () => {
  const sr = 44100;
  assert.ok(Math.abs(responseAt(Float32Array.from([1]), 1234, sr) - 1) < 1e-9, 'an impulse is flat');
  const one = bodyImpulse(sr, { modes: [{ freq: 200, Q: 20, dB: 6 }] });
  assert.equal(one[0], 1);
  assert.ok(Math.abs(dB(responseAt(one, 200, sr)) - 6.5) < 1, `peak ${dB(responseAt(one, 200, sr))} dB`); // 6 dB over the direct, which adds its own
  assert.ok(Math.abs(dB(responseAt(one, 2000, sr))) < 0.5, 'and leaves the rest alone');
  const ring = (from, to) => one.slice(Math.floor(from * sr), Math.floor(to * sr)).reduce((a, v) => a + v * v, 0);
  assert.ok(ring(0.001, 0.02) > ring(0.05, 0.07) * 4 && ring(0.05, 0.07) > 0, 'the mode decays over tens of milliseconds');
  const scaled = bodyImpulse(sr, { modes: [{ freq: 200, Q: 20, dB: 6 }], gain: 0.5, seconds: 0.2 });
  assert.equal(scaled.length, Math.floor(0.2 * sr));
  assert.ok(Math.abs(scaled[0] - 0.5) < 1e-9 && Math.abs(scaled[100] - one[100] * 0.5) < 1e-9);
  assert.ok(one.every(Number.isFinite));
});

test('disperse keeps every harmonic of a period and lowers its peak', () => {
  const len = 200;
  const period = new Float32Array(len);
  period[0] = 1; // an ideal pluck's force pulse once the plate has tilted it: a spike at the release and one at the pick position
  period[34] = -1;
  const spread = disperse(period, 12, -0.6);
  assert.equal(spread.length, len);
  const magnitude = (s, h) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < len; i++) {
      re += s[i] * Math.cos((2 * Math.PI * h * i) / len);
      im -= s[i] * Math.sin((2 * Math.PI * h * i) / len);
    }
    return Math.hypot(re, im);
  };
  for (const h of [1, 2, 3, 6, 12, 25]) assert.ok(Math.abs(magnitude(spread, h) - magnitude(period, h)) < 1e-4 * (magnitude(period, h) + 1), `harmonic ${h}`);
  const crest = (s) => Math.max(...Array.from(s, Math.abs)) / Math.sqrt(s.reduce((a, v) => a + v * v, 0) / len);
  assert.ok(crest(spread) < crest(period) * 0.6, `crest ${crest(period)} -> ${crest(spread)}`);
});
