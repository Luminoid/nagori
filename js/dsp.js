// Signal processing shared by the tab player (a live Web Audio graph) and the
// offline renderer, so a WAV render goes through the same filters and the same
// room as the browser: RBJ biquads (the formulas BiquadFilterNode implements),
// FFT convolution, and a synthesized room impulse response for the reverb.
// Pure functions on Float32Arrays; no DOM, no AudioContext.

/** Deterministic noise (mulberry32) in [-1, 1), so a seed always gives the same signal and tests are stable. */
export function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

// --- Biquads ------------------------------------------------------------------

/**
 * Normalized biquad coefficients { b0, b1, b2, a1, a2 } from the RBJ cookbook,
 * the same formulas the Web Audio BiquadFilterNode uses. `Q` is linear for
 * every type here (the live node wants it in dB for lowpass and highpass, see
 * `applyBiquad`); `gain` is in dB and only matters for peaking and shelves.
 */
export function biquad(type, freq, sampleRate, { Q = Math.SQRT1_2, gain = 0 } = {}) {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gain / 40);
  const alpha = sin / (2 * Q);
  const shelfAlpha = sin / Math.SQRT2; // the shelves use a slope of 1, as BiquadFilterNode does
  const rootA2 = 2 * Math.sqrt(A) * shelfAlpha;
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf':
      b0 = A * (A + 1 - (A - 1) * cos + rootA2);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - rootA2);
      a0 = A + 1 + (A - 1) * cos + rootA2;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - rootA2;
      break;
    case 'highshelf':
      b0 = A * (A + 1 + (A - 1) * cos + rootA2);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - rootA2);
      a0 = A + 1 - (A - 1) * cos + rootA2;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - rootA2;
      break;
    default:
      throw new Error(`unknown biquad type ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run samples through one biquad (transposed direct form II); returns a new array. */
export function filterSamples(samples, { b0, b1, b2, a1, a2 }) {
  const out = new Float32Array(samples.length);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

/** Run samples through a chain of filter specs [{ type, freq, Q, gain }]. */
export function filterChain(samples, specs, sampleRate) {
  let out = samples;
  for (const spec of specs) out = filterSamples(out, biquad(spec.type, spec.freq, sampleRate, spec));
  return out;
}

/** Magnitude response (linear) of a biquad at a frequency, for tests and tuning. */
export function biquadMagnitude({ b0, b1, b2, a1, a2 }, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = b0 + b1 * c1 + b2 * c2;
  const numIm = -(b1 * s1 + b2 * s2);
  const denRe = 1 + a1 * c1 + a2 * c2;
  const denIm = -(a1 * s1 + a2 * s2);
  return Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
}

/**
 * Configure a live BiquadFilterNode from a spec. BiquadFilterNode reads Q in
 * dB for lowpass and highpass and linear for the others; the specs here are
 * always linear, so the offline biquad and the live node match.
 */
export function applyBiquad(node, { type, freq, Q = Math.SQRT1_2, gain = 0 }) {
  node.type = type;
  node.frequency.value = freq;
  node.Q.value = type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(Q) : Q;
  node.gain.value = gain;
  return node;
}

/**
 * Disperse the phases of one period of a signal: a chain of first-order
 * allpass filters (coefficient `a`, negative to delay the low frequencies
 * more than the high, as a stiff string does), run around the period until
 * they have settled, so the magnitudes are untouched and a spike is spread
 * into a short chirp. Returns a new array.
 */
export function disperse(period, stages = 8, a = -0.6) {
  const len = period.length;
  const out = new Float32Array(len);
  const x1 = new Float64Array(stages);
  const y1 = new Float64Array(stages);
  const rounds = 4;
  for (let i = 0; i < rounds * len; i++) {
    let v = period[i % len];
    for (let s = 0; s < stages; s++) {
      const y = a * v + x1[s] - a * y1[s];
      x1[s] = v;
      y1[s] = y;
      v = y;
    }
    if (i >= (rounds - 1) * len) out[i - (rounds - 1) * len] = v;
  }
  return out;
}

// --- FFT convolution ----------------------------------------------------------

/** In-place iterative radix-2 FFT (inverse when `inverse`, scaled by 1/n). */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Convolve a signal with an impulse response (overlap-add, FFT blocks), keeping
 * the signal's length: the tail past the end is dropped. Short responses go
 * through direct convolution.
 */
export function convolve(signal, ir) {
  const n = signal.length;
  const out = new Float32Array(n);
  if (ir.length <= 64) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < ir.length && k <= i; k++) acc += signal[i - k] * ir[k];
      out[i] = acc;
    }
    return out;
  }
  let size = 1024;
  while (size < ir.length) size <<= 1;
  const fftSize = size * 2; // block + response - 1 fits
  const block = fftSize - ir.length + 1;
  const irRe = new Float64Array(fftSize);
  const irIm = new Float64Array(fftSize);
  irRe.set(ir);
  fft(irRe, irIm);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let start = 0; start < n; start += block) {
    re.fill(0);
    im.fill(0);
    const count = Math.min(block, n - start);
    for (let i = 0; i < count; i++) re[i] = signal[start + i];
    fft(re, im);
    for (let i = 0; i < fftSize; i++) {
      const r = re[i] * irRe[i] - im[i] * irIm[i];
      im[i] = re[i] * irIm[i] + im[i] * irRe[i];
      re[i] = r;
    }
    fft(re, im, true);
    const limit = Math.min(fftSize, n - start);
    for (let i = 0; i < limit; i++) out[start + i] += re[i];
  }
  return out;
}

// --- Room ---------------------------------------------------------------------

/**
 * A small room as an impulse response: a few early reflections, then a dense,
 * exponentially decaying tail of sparse random pulses (velvet noise, which
 * sounds smooth without the hiss of white noise), darkened over time by a
 * one-pole low-pass. Two channels with different pulse positions give the
 * stereo width; channel 0 is the one the offline renderer uses. Normalized to
 * unit energy so a wet gain is a plain level.
 */
export function roomImpulse(sampleRate, { seconds = 0.8, t60 = 0.6, seed = 11, channels = 2, density = 2200, cutoff = 4200 } = {}) {
  const n = Math.max(16, Math.floor(seconds * sampleRate));
  const early = [
    [0.0091, 0.55],
    [0.0148, -0.42],
    [0.0219, 0.36],
    [0.0288, -0.3],
    [0.0362, 0.26],
    [0.0447, -0.21],
  ];
  const out = [];
  for (let ch = 0; ch < channels; ch++) {
    const ir = new Float32Array(n);
    const rand = noise(seed + ch * 7919);
    for (const [t, g] of early) {
      const at = Math.floor((t + ch * 0.0017) * sampleRate);
      if (at < n) ir[at] += g;
    }
    const spacing = sampleRate / density;
    const tailFrom = 0.02 * sampleRate;
    for (let slot = 0; ; slot++) {
      const at = Math.floor(tailFrom + slot * spacing + ((rand() + 1) / 2) * spacing);
      if (at >= n) break;
      const env = Math.exp((-6.908 * (at / sampleRate)) / t60);
      ir[at] += (rand() < 0 ? -1 : 1) * 0.35 * env;
    }
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (ir[i] - lp) * alpha;
      ir[i] = lp;
    }
    let energy = 0;
    for (let i = 0; i < n; i++) energy += ir[i] * ir[i];
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let i = 0; i < n; i++) ir[i] *= scale;
    out.push(ir);
  }
  return out;
}

// --- Body ---------------------------------------------------------------------

/**
 * A guitar body as an impulse response: the broadband radiation of the top
 * plate (an impulse, `direct`) plus its resonances, each a decaying sinusoid
 * given as { freq, Q, dB }, its own peak relative to the direct level (the
 * two add, so the response rises about a decibel more). Narrow modes side by
 * side make the hills and dips of a real body's response, the strong ones (the
 * air resonance, the first top-plate mode) ring on after a pluck, the thump
 * under an acoustic note. The result is scaled by `gain`.
 */
export function bodyImpulse(sampleRate, { modes, direct = 1, gain = 1, seconds = 0.4 }) {
  const n = Math.max(16, Math.floor(seconds * sampleRate));
  const ir = new Float32Array(n);
  ir[0] = direct;
  for (const { freq, Q, dB } of modes) {
    const tau = Q / (Math.PI * freq); // seconds to 1/e
    const r = Math.exp(-1 / (tau * sampleRate));
    const amp = (2 * Math.pow(10, dB / 20)) / (tau * sampleRate); // peak of the resonance in the response
    const w = (2 * Math.PI * freq) / sampleRate;
    let re = amp; // amp * r^i * sin(w i), by rotation
    let im = 0;
    const cos = r * Math.cos(w);
    const sin = r * Math.sin(w);
    const stop = Math.min(n, Math.ceil(tau * sampleRate * 8)); // below -70 dB
    for (let i = 0; i < stop; i++) {
      ir[i] += im;
      const next = re * cos - im * sin;
      im = re * sin + im * cos;
      re = next;
    }
  }
  if (gain !== 1) for (let i = 0; i < n; i++) ir[i] *= gain;
  return ir;
}

/** Magnitude (linear) of an impulse response at a frequency, for tests and tuning. */
export function responseAt(ir, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < ir.length; i++) {
    re += ir[i] * Math.cos(w * i);
    im -= ir[i] * Math.sin(w * i);
  }
  return Math.hypot(re, im);
}
