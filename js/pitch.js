// Pitch detection for the tuner: normalized square difference (McLeod) with
// key-maximum picking and parabolic interpolation. Pure, runs in Node.

/** { freq, clarity } for a mono sample frame, or null when nothing periodic is loud enough. */
export function detectPitch(samples, sampleRate, { fmin = 55, fmax = 1400, minRms = 0.005, threshold = 0.85 } = {}) {
  const n = samples.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / n) < minRms) return null;
  const minLag = Math.max(2, Math.floor(sampleRate / (fmax * 1.5)));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / fmin));
  if (maxLag <= minLag) return null;
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0;
    let norm = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      acf += a * b;
      norm += a * a + b * b;
    }
    nsdf[lag] = norm > 0 ? (2 * acf) / norm : 0;
  }
  // Key maxima: the highest point of each positive run after the first dip.
  const peaks = [];
  let lag = minLag;
  while (lag <= maxLag && nsdf[lag] > 0) lag++;
  while (lag <= maxLag) {
    while (lag <= maxLag && nsdf[lag] <= 0) lag++;
    let best = -1;
    let bestValue = -Infinity;
    while (lag <= maxLag && nsdf[lag] > 0) {
      if (nsdf[lag] > bestValue) {
        bestValue = nsdf[lag];
        best = lag;
      }
      lag++;
    }
    if (best > 0) peaks.push({ lag: best, value: bestValue });
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => p.value));
  const chosen = peaks.find((p) => p.value >= threshold * top);
  if (chosen.value < 0.5) return null;
  const a = nsdf[chosen.lag - 1];
  const b = nsdf[chosen.lag];
  const c = chosen.lag + 1 <= maxLag ? nsdf[chosen.lag + 1] : b;
  const denominator = a - 2 * b + c;
  const shift = denominator !== 0 ? (0.5 * (a - c)) / denominator : 0;
  const freq = sampleRate / (chosen.lag + shift);
  if (freq < fmin * 0.97 || freq > fmax) return null;
  return { freq, clarity: b };
}

/** Nearest equal-tempered note: { midi, cents } with cents in -50..50. */
export function nearestNote(freq) {
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}
