// Tab playback: renders the transcription with Web Audio. Every note is a
// plucked string synthesized in the browser (a Karplus-Strong string through a
// modal guitar body), scheduled from a bar clock built on the written tempo,
// so the tab plays without the video.
//
// The pure parts (bar times, note events, buffers, an offline mix) run in Node
// for tests and scripts; TabPlayer needs an AudioContext (injectable).

import { durationValue } from './util.js';
import { midiToFreq } from './theory.js';
import { beatFractions } from './tab-renderer.js';
import { BarClock } from './video-sync.js';
import { noise, filterChain, applyBiquad, convolve, roomImpulse, bodyImpulse, disperse } from './dsp.js';

const LOOKAHEAD = 0.4; // seconds of audio scheduled ahead of the clock
const HIDDEN_LOOKAHEAD = 1.5; // while the tab is hidden and its timers run once a second at best
const SCHEDULE_MS = 60;
const BUFFER_CAP = 128; // AudioBuffers a player keeps (a song's own set always fits): a long session must not keep growing
const RATE_KEY = 'nagori:rate'; // the sample rate of the last AudioContext seen, so plucks can be synthesized before the first play at the right rate
const START_DELAY = 0.06;
const RING_MAX = 5; // let-ring notes decay on their own unless the string is plucked again
const STRUM_GAP = 0.007; // seconds between the strings of a chord
const STROKE_GAP = 0.018; // marked up and down strokes
const RELEASE = 0.05;
const DEAD_LENGTH = 0.1;
const LEVEL = { guitar: 0.8, bass: 1 };
const MASTER = 0.85; // the mix level before the compressor (live) or the WAV's normalization (offline)
const TONE_HZ = 3200; // low-pass after the drive stage, so the clipping harmonics stay rounded
const BASS_REVERB = 0.1;
const SHIFT = 0.004; // seconds a beat may land early or late of the grid
const TOUCH = 0.12; // how much lighter than written a note may be struck
const LAYER_SOFT = 0.7; // a note under this gain (a hammer-on, a ghost note, a slide's arrival) plays the soft layer
const VARIANTS = 2; // plucks of one string alternate between this many renderings of a pitch
const GLIDE_SETTLE = 0.1; // seconds for the attack's pitch glide to fall to 1/e
const ATTACK_RMS = 0.18; // a pluck's loudness over its first 20 ms; its ringing peaks then stay under the knee
const KNEE = 0.75; // above this a pluck's samples are rounded off softly, so the spike of its attack stays under 0.95
const DISPERSION = { stages: 12, a: -0.6 }; // the allpass chain that spreads a pluck's spikes (see disperse in dsp.js)
const PLATE_TILT = 300; // Hz above which the pluck's pulse rises 6 dB per octave: the top plate radiates the upper partials better than the fundamentals

/**
 * Guitar sounds for the tab. Each is a preset over the same string model:
 * `brightness` (how much of the pluck's top end survives), `grit` (how much of
 * the pluck is the noise of the pick's release rather than the clean pulse of
 * an ideal pluck), `pickNoise` (the level of the pick's contact transient),
 * `glide` (cents sharp the string starts, the stretch of a hard pluck settling
 * over its first tenth of a second), `sustain` (a multiplier on the decay
 * time), `pick` (where along the string it is plucked, as a fraction of its
 * length: nearer the bridge is thinner and brighter), `damping` (how fast the
 * upper harmonics die: 0.5 is the most), `lowpass` (an extra roll-off inside
 * the string, nylon has a lot), `detune` (cents between the two polarizations
 * of the string, the slow shimmer of a real note), `body` (which instrument
 * the part sounds through, see BODIES), `reverb` (the send level into the
 * shared room) and `drive` (0 clean; above it the part goes through a soft
 * clipper and a tone roll-off before the body). The bass keeps its own timbre
 * whatever the guitar sound.
 */
export const SOUNDS = {
  acoustic: { brightness: 0.7, grit: 0.45, pickNoise: 0.1, glide: 10, sustain: 1, drive: 0, pick: 0.17, damping: 0.32, lowpass: 0.12, detune: 1.2, body: 'steel', reverb: 0.22 },
  electric: { brightness: 0.5, grit: 0.4, pickNoise: 0.06, glide: 6, sustain: 1.5, drive: 0, pick: 0.12, damping: 0.28, lowpass: 0.1, detune: 0.6, body: 'pickup', reverb: 0.16 },
  overdrive: { brightness: 0.52, grit: 0.4, pickNoise: 0.06, glide: 6, sustain: 1.8, drive: 0.7, pick: 0.12, damping: 0.3, lowpass: 0.1, detune: 0.6, body: 'pickup', reverb: 0.14 },
  nylon: { brightness: 0.34, grit: 0.35, pickNoise: 0.04, glide: 8, sustain: 0.8, drive: 0, pick: 0.24, damping: 0.5, lowpass: 0.35, detune: 0.8, body: 'nylon', reverb: 0.24 },
  muted: { brightness: 0.65, grit: 0.6, pickNoise: 0.15, glide: 2, sustain: 0.12, drive: 0, pick: 0.1, damping: 0.5, lowpass: 0.2, detune: 0, body: 'steel', reverb: 0.1 },
};

/**
 * The instrument a string sounds through. An acoustic box is a set of
 * resonances (`modes`, see bodyImpulse in dsp.js: the air resonance and the
 * first top-plate mode ring on under every note, the thump of an acoustic
 * guitar, and the lower Q modes above them overlap into the hills of the
 * body's response) convolved with the part, then an `eq` of biquads (applied
 * live with BiquadFilterNodes and offline with the same coefficients). An
 * electric pickup and a bass amp are eq only: a presence peak, a cabinet.
 */
export const BODIES = {
  steel: {
    modes: [
      { freq: 98, Q: 11, dB: 6 },
      { freq: 194, Q: 13, dB: 5 },
      { freq: 128, Q: 18, dB: 1 },
      { freq: 250, Q: 20, dB: 1 },
      { freq: 318, Q: 22, dB: 2 },
      { freq: 402, Q: 22, dB: 3 },
      { freq: 486, Q: 22, dB: 1 },
      { freq: 575, Q: 24, dB: 2 },
      { freq: 690, Q: 24, dB: 2 },
      { freq: 815, Q: 24, dB: 1 },
      { freq: 970, Q: 26, dB: 2 },
      { freq: 1180, Q: 26, dB: 1 },
      { freq: 1420, Q: 26, dB: 2 },
      { freq: 1730, Q: 28, dB: 1 },
      { freq: 2120, Q: 28, dB: 2 },
      { freq: 2580, Q: 28, dB: 3 },
      { freq: 3170, Q: 30, dB: 1 },
      { freq: 3920, Q: 30, dB: 1 },
      { freq: 4650, Q: 30, dB: 2 },
    ],
    gain: 0.8,
    eq: [
      { type: 'highpass', freq: 75, Q: 0.7 },
      { type: 'lowshelf', freq: 350, gain: -2.5 },
      { type: 'highshelf', freq: 6500, gain: -4 },
    ],
  },
  nylon: {
    modes: [
      { freq: 96, Q: 12, dB: 6 },
      { freq: 202, Q: 14, dB: 6 },
      { freq: 124, Q: 18, dB: 1 },
      { freq: 262, Q: 20, dB: 2 },
      { freq: 336, Q: 22, dB: 3 },
      { freq: 418, Q: 22, dB: 2 },
      { freq: 508, Q: 22, dB: 2 },
      { freq: 610, Q: 24, dB: 2 },
      { freq: 735, Q: 24, dB: 1 },
      { freq: 890, Q: 24, dB: 2 },
      { freq: 1060, Q: 26, dB: 0 },
      { freq: 1310, Q: 26, dB: 1 },
      { freq: 1610, Q: 26, dB: 1 },
      { freq: 2010, Q: 28, dB: 1 },
      { freq: 2510, Q: 28, dB: 3 },
      { freq: 3120, Q: 30, dB: 1 },
    ],
    gain: 0.8,
    eq: [
      { type: 'highpass', freq: 70, Q: 0.7 },
      { type: 'lowshelf', freq: 350, gain: -2.5 },
      { type: 'peaking', freq: 1100, Q: 1, gain: -2 },
      { type: 'lowpass', freq: 5200, Q: 0.7 },
    ],
  },
  pickup: {
    eq: [
      { type: 'highpass', freq: 60, Q: 0.7 },
      { type: 'peaking', freq: 3000, Q: 1.8, gain: 3 },
      { type: 'lowpass', freq: 6000, Q: 0.9 },
    ],
  },
  bass: {
    eq: [
      { type: 'highpass', freq: 32, Q: 0.7 },
      { type: 'peaking', freq: 110, Q: 1.5, gain: 2 },
      { type: 'lowpass', freq: 3200, Q: 0.7 },
    ],
  },
};
export const DEFAULT_SOUND = 'acoustic';
/** The pseudo-sound that lets every part use the sound its song data sets (`tracks[].sound`). */
export const SOUND_AUTO = 'auto';
export const soundName = (name) => (SOUNDS[name] ? name : DEFAULT_SOUND);
/** The sound a part plays with: the listener's choice unless it is "auto", then the part's own, then the default. */
const resolveSound = (choice, partSound) => (choice && choice !== SOUND_AUTO ? soundName(choice) : soundName(partSound));

// --- Clock --------------------------------------------------------------------

/** Tempo in quarter notes per minute from a tempo-map entry: { bpm, unit } (unit 4 quarter, 2 half). */
export function quarterBpm(entry) {
  return (entry.bpm * 4) / (entry.unit || 4);
}

/** Whole-note length of bar `i`: the signature, unless every part writes the bar shorter (a pickup or a closing bar). */
function barWholeNotes(sig, i, allMeasures) {
  const nominal = sig[0] / sig[1];
  let longest = 0;
  for (const measures of allMeasures) {
    const measure = measures[i];
    if (!measure) continue;
    if (measure.beats.length === 1 && measure.beats[0].rest && measure.beats[0].t === 1) return nominal; // a whole rest fills any bar
    longest = Math.max(longest, measure.beats.reduce((a, b) => a + durationValue(b), 0));
  }
  return longest > 0 && longest < nominal - 1e-9 ? longest : nominal;
}

/**
 * Bar start times (seconds) at the written tempo, from each bar's time signature
 * and the tempo map (a tempo entry with `pos` > 0 takes effect inside its bar).
 * `allMeasures`: every part's measures, so a bar every part writes short (a pickup) keeps its written length.
 */
export function tabBarTimes(measures, { tempo = [], bpm = 120, timeSignature = [4, 4], allMeasures = null } = {}) {
  const barTimes = [];
  const barWholes = [];
  const parts = allMeasures && allMeasures.length ? allMeasures : [measures];
  let sig = timeSignature;
  let current = tempo && tempo.length ? quarterBpm(tempo[0]) : bpm;
  let next = 0;
  let t = 0;
  for (let i = 0; i < measures.length; i++) {
    if (measures[i].sig) sig = measures[i].sig;
    while (tempo && next < tempo.length && tempo[next].bar < i) current = quarterBpm(tempo[next++]);
    const whole = barWholeNotes(sig, i, parts);
    barTimes.push(t);
    barWholes.push(whole);
    let from = 0;
    while (tempo && next < tempo.length && tempo[next].bar === i) {
      const pos = Math.min(1, Math.max(from, tempo[next].pos || 0));
      t += (pos - from) * whole * 4 * (60 / current);
      from = pos;
      current = quarterBpm(tempo[next++]);
    }
    t += (1 - from) * whole * 4 * (60 / current);
  }
  return { barTimes, end: t, barWholes };
}

/** A BarClock for the tab itself (as opposed to the video's sync map). `allMeasures`: every part's measures, for pickup bars. */
export function tabClock(song, measures, allMeasures = null) {
  const { barTimes, end, barWholes } = tabBarTimes(measures, { tempo: song.tempo, bpm: song.bpm, timeSignature: song.timeSignature, allMeasures });
  const clock = new BarClock(barTimes, { bpm: song.bpm, timeSignature: song.timeSignature, end });
  clock.barWholes = barWholes;
  return clock;
}

// --- Events -------------------------------------------------------------------

/**
 * Note events for every track, sorted by start time:
 * { t, end, hold, track, kind, string, midi, gain, dead, ring, bend, slide, slideTo, shift, touch, variant }.
 * Tied notes extend the note they continue instead of sounding again; let-ring
 * notes sound until the same string is plucked; a pluck cuts whatever the string
 * was still playing. Tracks are { id, kind, tuning, strings, capo?, sound?, measures };
 * a part's `sound` rides on its events so the mix can honour it. `t` is the
 * written time; `shift` (seconds) and `touch` (a gain factor) are the nuance of
 * a hand, a few milliseconds and a little weight either way, the same for every
 * build, and `variant` alternates between renderings of the pitch on each
 * pluck of a string, so no two notes are the same samples.
 */
export function buildEvents(tracks, clock) {
  const events = [];
  tracks.forEach((track, index) => {
    const capo = track.capo || 0;
    const sounding = new Array(track.strings).fill(null);
    const hammered = new Array(track.strings).fill(false); // the previous note on the string was marked hp
    const plucks = new Array(track.strings).fill(0);
    track.measures.forEach((measure, bar) => {
      if (bar >= clock.bars) return;
      const barStart = clock.barToTime(bar);
      const barDur = clock.duration(bar);
      const total = measure.beats.reduce((a, b) => a + durationValue(b), 0) || 1;
      const starts = beatFractions(measure);
      measure.beats.forEach((beat, j) => {
        if (beat.rest || !beat.notes.length) return;
        const start = barStart + starts[j] * barDur;
        const hold = start + (durationValue(beat) / total) * barDur;
        const notes = [...beat.notes].sort((a, b) => b.s - a.s); // low string first
        if (beat.stroke === 'up') notes.reverse();
        const hand = noise(bar * 131 + j * 17 + index * 7919 + 1);
        const beatShift = hand() * SHIFT;
        const gap = (beat.stroke ? STROKE_GAP : notes.length > 1 ? STRUM_GAP : 0) * (1.05 + hand() * 0.25);
        notes.forEach((note, k) => {
          const t = start + k * gap;
          const prev = sounding[note.s];
          if (note.tie && prev && !prev.dead) {
            prev.end = prev.ring ? Math.max(prev.end, hold) : hold;
            prev.hold = hold;
            if (beat.ring) prev.ring = true;
            return;
          }
          const midi = track.tuning[note.s] + capo + (note.f || 0);
          let gain = note.dead ? 0.5 : note.ghost ? 0.4 : 1;
          if (hammered[note.s] && !note.dead) gain *= 0.55;
          hammered[note.s] = !!note.hp;
          if (prev) {
            const adjacent = Math.abs(prev.hold - start) < 0.02;
            if (prev.end > t) prev.end = t;
            if (adjacent && (prev.slide === 'shift' || prev.slide === 'legato') && !note.dead) {
              prev.slideTo = midi;
              if (prev.slide === 'legato') gain *= 0.6;
            }
          }
          const event = {
            t,
            end: note.dead ? t + DEAD_LENGTH : beat.ring ? t + RING_MAX : hold,
            hold,
            track: track.id,
            kind: track.kind,
            sound: track.sound || null,
            string: note.s,
            midi,
            gain,
            dead: !!note.dead,
            ring: !!beat.ring && !note.dead,
            bend: note.bend || 0,
            slide: note.slide || null,
            slideTo: null,
            shift: Math.max(-t, beatShift + hand() * SHIFT * 0.25),
            touch: 1 - ((hand() + 1) / 2) * TOUCH,
            variant: plucks[note.s]++ % VARIANTS,
          };
          events.push(event);
          sounding[note.s] = event;
        });
      });
    });
  });
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** Metronome clicks: { t, accent } per beat, two per bar in compound meters (6/8). */
export function buildClicks(measures, clock, timeSignature = [4, 4]) {
  const clicks = [];
  let sig = timeSignature;
  measures.forEach((measure, bar) => {
    if (bar >= clock.bars) return;
    if (measure.sig) sig = measure.sig;
    const count = sig[1] === 8 && sig[0] % 3 === 0 ? sig[0] / 3 : sig[0];
    const barStart = clock.barToTime(bar);
    const step = clock.duration(bar) / count;
    for (let i = 0; i < count; i++) clicks.push({ t: barStart + i * step, accent: i === 0 });
  });
  return clicks;
}

function lowerBound(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// --- Synthesis ----------------------------------------------------------------

/**
 * Timbre per instrument, guitar sound and touch, as pluckBuffer options: the
 * pluck's brightness, grit and pick noise, the -60 dB time (longer for low
 * notes), the buffer length, the string model's pick position, damping, in-loop
 * low-pass and detune, and the pitch glide of the attack. The `soft` layer (a
 * hammer-on, a ghost note, a slide's arrival) is darker, with less glide and
 * less pick noise, as a lighter touch is.
 */
export function timbre(kind, freq, sound = DEFAULT_SOUND, layer = 'full') {
  const soft = layer === 'soft';
  if (kind === 'bass') {
    const t60 = Math.min(6, Math.max(2, 5 * Math.pow(55 / freq, 0.3)));
    return { brightness: soft ? 0.22 : 0.3, t60, seconds: 4, pick: 0.11, damping: 0.5, lowpass: 0.45, detune: 0, grit: 0.5, glide: soft ? 3 : 6, pickNoise: soft ? 0.02 : 0.05 };
  }
  const preset = SOUNDS[soundName(sound)];
  const t60 = Math.min(5, Math.max(1.2, 4 * Math.pow(165 / freq, 0.4))) * preset.sustain;
  return {
    brightness: soft ? preset.brightness * 0.7 : preset.brightness,
    t60,
    seconds: Math.min(4, Math.max(0.6, t60 * 0.75)),
    pick: preset.pick,
    damping: preset.damping,
    lowpass: preset.lowpass,
    detune: preset.detune,
    grit: preset.grit,
    glide: soft ? preset.glide * 0.5 : preset.glide,
    pickNoise: soft ? preset.pickNoise * 0.4 : preset.pickNoise,
  };
}

/** Soft clipper for the drive stage: tanh with a gain that grows with the amount, scaled back so peaks stay below 1. */
export function driveCurve(amount, size = 2048) {
  const k = 1 + amount * 12;
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    out[i] = 0.45 * Math.tanh(k * x);
  }
  return out;
}

/** The drive stage on a block of samples: the same clipper as the live curve, then a one-pole tone roll-off. */
export function driveSamples(samples, amount, sampleRate) {
  const k = 1 + amount * 12;
  const alpha = 1 - Math.exp((-2 * Math.PI * TONE_HZ) / sampleRate);
  const out = new Float32Array(samples.length);
  let lp = 0;
  for (let i = 0; i < samples.length; i++) {
    lp += (0.45 * Math.tanh(k * samples[i]) - lp) * alpha;
    out[i] = lp;
  }
  return out;
}

/**
 * One period of excitation for a plucked string. The ideal pluck: the force a
 * released string puts on the bridge over one round trip is a rectangular
 * pulse, on for the pick's fraction of the period (so a pluck a fifth of the
 * way along the string cannot excite every fifth harmonic). Over it, `grit` of
 * noise comb-filtered at the same position, the roughness of the pick's
 * release. The pulse is tilted up above PLATE_TILT (the plate radiates the
 * upper partials better than the fundamentals), both are low-passed by
 * `brightness` (the noise twice, so it sits under the pulse rather than
 * hissing over it) and mixed at equal power, zero mean. The mix is then
 * dispersed (see disperse in dsp.js): the pulse's two spikes become short
 * chirps, as a stiff string's corners are, with the same spectrum and a third
 * of the peak.
 */
function pluckExcitation(freq, sampleRate, { brightness, pick, grit, seed }) {
  const len = Math.max(2, Math.round(sampleRate / freq));
  const comb = Math.min(len - 1, Math.max(1, Math.round(pick * len)));
  const pulse = new Float32Array(len);
  const tilt = Math.exp((-2 * Math.PI * PLATE_TILT) / sampleRate);
  let lp = 0;
  let last = 0;
  for (let i = 0; i < 2 * len; i++) {
    // two rounds, so the filters have settled into the period
    const force = (i % len < comb ? len - comb : -comb) / len;
    lp += (force - tilt * last - lp) * brightness; // the pulse, tilted up above PLATE_TILT, then softened by the pick
    last = force;
    if (i >= len) pulse[i - len] = lp;
  }
  const rand = noise(seed);
  const burst = new Float32Array(len);
  let first = 0;
  lp = 0;
  for (let i = 0; i < len; i++) {
    first += (rand() - first) * brightness;
    lp += (first - lp) * brightness;
    burst[i] = lp;
  }
  const rough = new Float32Array(len);
  for (let i = 0; i < len; i++) rough[i] = burst[i] - burst[(i - comb + len) % len];
  const rms = (samples) => Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / len) || 1;
  const a = (1 - grit) / rms(pulse);
  const b = grit / rms(rough);
  const out = new Float32Array(len);
  let mean = 0;
  for (let i = 0; i < len; i++) {
    out[i] = a * pulse[i] + b * rough[i];
    mean += out[i];
  }
  mean /= len;
  for (let i = 0; i < len; i++) out[i] -= mean;
  return disperse(out, DISPERSION.stages, DISPERSION.a);
}

/**
 * One string of the Karplus-Strong loop, added into `out` at `level`: a
 * fractional delay line (linear interpolation) fed back through a two-point
 * weighted average (`damping`, 0.5 is the plain average), an optional one-pole
 * low-pass inside the loop, and a per-period loss that reaches -60 dB after
 * `t60` seconds. The loop filters' phase delay at the fundamental is taken off
 * the delay line, so the string rings at `freq` whatever the filters. With
 * `glide`, the string starts that many cents sharp (a hard pluck stretches it)
 * and settles with a GLIDE_SETTLE time constant: the delay line shortens by
 * the same fraction and grows back.
 */
function stringLoop(out, excitation, freq, sampleRate, { t60, damping, lowpass, level, glide = 0 }) {
  const n = out.length;
  const w = damping;
  const omega = (2 * Math.PI * freq) / sampleRate;
  let tau = Math.atan2(w * Math.sin(omega), 1 - w + w * Math.cos(omega)) / omega;
  if (lowpass > 0) tau += Math.atan2(lowpass * Math.sin(omega), 1 - lowpass * Math.cos(omega)) / omega;
  const period = Math.max(2, sampleRate / freq - tau);
  const len = Math.min(excitation.length, n);
  const line = new Float32Array(n);
  for (let i = 0; i < len; i++) line[i] = excitation[i];
  const decay = Math.pow(10, -3 / (t60 * freq));
  const settle = Math.exp(-1 / (GLIDE_SETTLE * sampleRate));
  let cents = glide;
  let state = 0;
  const start = Math.max(len, Math.ceil(period) + 1); // the first sample whose delayed reads exist
  for (let i = start; i < n; i++) {
    let p = period;
    if (cents > 0.01) {
      p = period * (1 - (cents * Math.LN2) / 1200);
      cents *= settle;
    }
    const pos = i - p;
    const k = Math.floor(pos);
    const fr = pos - k;
    const before = k > 0 ? line[k - 1] : 0;
    const x0 = line[k] + (line[k + 1] - line[k]) * fr;
    const x1 = before + (line[k] - before) * fr;
    let y = (1 - w) * x0 + w * x1;
    if (lowpass > 0) {
      state += (y - state) * (1 - lowpass);
      y = state;
    }
    line[i] = decay * y;
  }
  for (let i = 0; i < n; i++) out[i] += level * line[i];
}

/**
 * A plucked string as samples: a Karplus-Strong loop (see stringLoop) driven by
 * a pick-position excitation, doubled by a second, slightly detuned and faster
 * decaying string when `detune` is set (the two polarizations of a real string,
 * which give a note its slow shimmer), with the pick's contact (`pickNoise`: a
 * few milliseconds of dull noise over the attack) and a sub-millisecond fade
 * in, at a set attack loudness with its peaks rounded off under 0.95. The
 * `seed` picks the noise, so two seeds give two plucks of the same note.
 */
export function pluckBuffer(freq, sampleRate, { seconds = 3, t60 = 3, brightness = 0.55, seed = 1, pick = 0.15, damping = 0.5, lowpass = 0, detune = 0, grit = 0.45, glide = 0, pickNoise = 0 } = {}) {
  const n = Math.max(8, Math.floor(seconds * sampleRate));
  const out = new Float32Array(n);
  const excitation = pluckExcitation(freq, sampleRate, { brightness, pick, grit, seed });
  const strings = detune > 0 ? [[1, 0.7, 1], [Math.pow(2, detune / 1200), 0.3, 0.7]] : [[1, 1, 1]];
  for (const [ratio, level, sustain] of strings) stringLoop(out, excitation, freq * ratio, sampleRate, { t60: t60 * sustain, damping, lowpass, level, glide });
  if (pickNoise > 0) {
    const count = Math.min(n, Math.floor(sampleRate * 0.004));
    let attack = 0;
    for (let i = 0; i < count; i++) attack = Math.max(attack, Math.abs(out[i]));
    const rand = noise(seed + 977);
    let lp = 0;
    for (let i = 0; i < count; i++) {
      lp += (rand() - lp) * 0.35;
      out[i] += pickNoise * attack * lp * Math.exp(-i / (sampleRate * 0.0012));
    }
  }
  const fadeIn = Math.min(n, Math.floor(sampleRate * 0.0008));
  for (let i = 0; i < fadeIn; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  // The level is the attack's loudness, not its peak: the pulse of a bright
  // pluck is a spike, so whatever still tops the knee is rounded off below 0.95.
  const attack = Math.min(n, Math.floor(sampleRate * 0.02));
  let energy = 0;
  for (let i = 0; i < attack; i++) energy += out[i] * out[i];
  const scale = energy > 0 ? ATTACK_RMS / Math.sqrt(energy / attack) : 1;
  for (let i = 0; i < n; i++) {
    const v = out[i] * scale;
    const a = Math.abs(v);
    out[i] = a > KNEE ? Math.sign(v) * (KNEE + (0.95 - KNEE) * Math.tanh((a - KNEE) / (0.95 - KNEE))) : v;
  }
  const fade = Math.min(n, Math.floor(sampleRate * 0.05));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** A muted string: a short, dull noise burst. */
function muteBuffer(sampleRate, { seconds = DEAD_LENGTH, seed = 7 } = {}) {
  const n = Math.max(8, Math.floor(seconds * sampleRate));
  const out = new Float32Array(n);
  const rand = noise(seed);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += (rand() - lp) * 0.2;
    out[i] = lp * 2 * Math.exp(-i / (sampleRate * 0.018));
  }
  return out;
}

/** A metronome click: a decaying sine. */
export function clickBuffer(sampleRate, freq = 1000, seconds = 0.06) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * Math.exp(-i / (sampleRate * 0.01));
  return out;
}

/**
 * Cache key for an event's samples: the pitch, the layer (soft under
 * LAYER_SOFT), the variant, and for a guitar the sound in force for the part
 * (last, so the keys of one sound are easy to drop); bass keys carry no sound.
 */
/** The sample rate the next AudioContext will most likely have: the last one seen here, else 48 kHz. */
export function guessRate() {
  try {
    const stored = Number(localStorage.getItem(RATE_KEY));
    if (stored > 0) return stored;
  } catch {
    /* storage blocked */
  }
  return 48000;
}

/** Note an AudioContext's sample rate for the next visit's guess. */
export function rememberRate(rate) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* storage blocked */
  }
}

function bufferKey(event, sound = SOUND_AUTO) {
  if (event.dead) return 'dead';
  const layer = event.gain < LAYER_SOFT ? 'soft' : 'full';
  const variant = event.variant || 0;
  return event.kind === 'bass' ? `bass:${event.midi}:${layer}:${variant}` : `guitar:${event.midi}:${layer}:${variant}:${resolveSound(sound, event.sound)}`;
}

/** Samples for an event's buffer key, from a cache. */
function samplesFor(key, sampleRate, cache) {
  let samples = cache.get(key);
  if (!samples) {
    if (key === 'dead') samples = muteBuffer(sampleRate);
    else {
      const [kind, midi, layer, variant, sound] = key.split(':');
      const freq = midiToFreq(Number(midi));
      const seed = Number(midi) * 31 + Number(variant) * 1013 + (kind === 'bass' ? 7 : 1);
      samples = pluckBuffer(freq, sampleRate, { ...timbre(kind, freq, sound, layer), seed });
    }
    cache.set(key, samples);
  }
  return samples;
}

const rooms = new Map();
const bodies = new Map();

/** The room's impulse response for a sample rate (channel 0 is what the offline mix uses), built once. */
export function roomFor(sampleRate) {
  let room = rooms.get(sampleRate);
  if (!room) {
    room = roomImpulse(sampleRate);
    rooms.set(sampleRate, room);
  }
  return room;
}

/** The impulse response of a BODIES entry with modes for a sample rate, built once; null for an eq-only body. */
export function bodyFor(name, sampleRate) {
  const spec = BODIES[name];
  if (!spec || !spec.modes) return null;
  const key = `${name}:${sampleRate}`;
  let ir = bodies.get(key);
  if (!ir) {
    ir = bodyImpulse(sampleRate, spec);
    bodies.set(key, ir);
  }
  return ir;
}

/** A part's body (a BODIES key) and reverb send for its kind and sound. */
function partOutput(kind, preset) {
  if (kind === 'bass') return { body: 'bass', reverb: BASS_REVERB };
  return { body: BODIES[preset.body] ? preset.body : 'steel', reverb: preset.reverb };
}

/**
 * Mix events into one channel of samples between `from` and `to` (song
 * seconds), with the same levels, nuance, release, drive, body and room as live
 * playback but without pitch effects. Used by tests and scripts/render-audio.mjs.
 */
export function renderOffline(events, sampleRate, { from = 0, to = null, volumes = new Map(), master = MASTER, sound = SOUND_AUTO, reverb = true } = {}) {
  const end = to ?? (events.length ? Math.max(...events.map((e) => e.end)) : 0);
  const n = Math.max(1, Math.ceil((end - from) * sampleRate));
  const out = new Float32Array(n);
  const cache = new Map();
  const buses = new Map(); // one bus per track, so the drive stage sees a part's chords as a whole
  for (const event of events) {
    if (event.t < from || event.t >= end) continue;
    const samples = samplesFor(bufferKey(event, sound), sampleRate, cache);
    const level = event.gain * (event.touch ?? 1) * (LEVEL[event.kind] || 1) * (volumes.get(event.track) ?? 1) * master;
    if (level <= 0) continue;
    let bus = buses.get(event.track);
    if (!bus) {
      bus = { kind: event.kind, preset: SOUNDS[resolveSound(sound, event.sound)], samples: new Float32Array(n) };
      buses.set(event.track, bus);
    }
    const at = Math.round((event.t + (event.shift || 0) - from) * sampleRate);
    const skip = Math.max(0, -at); // a note nudged ahead of the start
    const releaseAt = Math.round((event.end - event.t) * sampleRate);
    const releaseLen = Math.round(RELEASE * sampleRate);
    const count = Math.min(samples.length, releaseAt + releaseLen, n - at);
    for (let i = skip; i < count; i++) {
      const env = i < releaseAt ? 1 : 1 - (i - releaseAt) / releaseLen;
      bus.samples[at + i] += samples[i] * level * env;
    }
  }
  const send = reverb ? new Float32Array(n) : null;
  for (const bus of buses.values()) {
    const { body, reverb: level } = partOutput(bus.kind, bus.preset);
    let samples = bus.kind !== 'bass' && bus.preset.drive > 0 ? driveSamples(bus.samples, bus.preset.drive, sampleRate) : bus.samples;
    const ir = bodyFor(body, sampleRate);
    if (ir) samples = convolve(samples, ir);
    samples = filterChain(samples, BODIES[body].eq, sampleRate);
    for (let i = 0; i < n; i++) out[i] += samples[i];
    if (send) for (let i = 0; i < n; i++) send[i] += samples[i] * level;
  }
  if (send) {
    const wet = convolve(send, roomFor(sampleRate)[0]);
    for (let i = 0; i < n; i++) out[i] += wet[i];
  }
  return out;
}

// --- Live chains ----------------------------------------------------------------

/** A ConvolverNode holding the room, for a wet bus; un-normalized so its level matches the offline mix. */
export function roomNode(ctx) {
  const channels = roomFor(ctx.sampleRate);
  const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((ir, i) => buffer.copyToChannel(ir, i));
  const node = ctx.createConvolver();
  node.normalize = false;
  node.buffer = buffer;
  return node;
}

/**
 * The output chain of one part on a live context: the drive stage when its
 * sound asks for one, the body (a ConvolverNode with its resonances, when it
 * has them, then its eq), then `dry` (the master) and a send at the sound's
 * level into `wet` (a roomNode), when given. Returns { input, nodes } so the
 * chain can be torn down when the sound changes.
 */
export function buildChain(ctx, { kind = 'guitar', sound = DEFAULT_SOUND, dry, wet = null }) {
  const preset = SOUNDS[soundName(sound)];
  const input = ctx.createGain();
  const nodes = [input];
  let head = input;
  if (kind !== 'bass' && preset.drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(preset.drive);
    shaper.oversample = '2x';
    const tone = ctx.createBiquadFilter();
    applyBiquad(tone, { type: 'lowpass', freq: TONE_HZ, Q: 0.7 });
    head.connect(shaper);
    shaper.connect(tone);
    head = tone;
    nodes.push(shaper, tone);
  }
  const { body, reverb } = partOutput(kind, preset);
  const ir = bodyFor(body, ctx.sampleRate);
  if (ir) {
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    buffer.copyToChannel(ir, 0);
    convolver.buffer = buffer;
    head.connect(convolver);
    head = convolver;
    nodes.push(convolver);
  }
  for (const spec of BODIES[body].eq) {
    const filter = applyBiquad(ctx.createBiquadFilter(), spec);
    head.connect(filter);
    head = filter;
    nodes.push(filter);
  }
  head.connect(dry);
  if (wet) {
    const sendGain = ctx.createGain();
    sendGain.gain.value = reverb;
    head.connect(sendGain);
    sendGain.connect(wet);
    nodes.push(sendGain);
  }
  return { input, nodes };
}

// --- Player -------------------------------------------------------------------

function defaultContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  return new Context({ latencyHint: 'interactive' });
}

/**
 * Plays the tab. Same surface as VideoSync: 'ready', 'tick' { time, bar, frac,
 * playing } every animation frame and 'state' { playing, ended }; play, pause,
 * toggle, seek, seekBar, setRate, setLoop, destroy. Plus setVolume(trackId,
 * 0..1), setClick(on) and setSound(name) for the guitar sound: a SOUNDS key
 * for every part, or SOUND_AUTO to let each part use its own `sound`. A part's
 * `level` (0..1) is its starting volume. The AudioContext is created on the
 * first play(), which must come from a user gesture.
 */
export class TabPlayer extends EventTarget {
  constructor({ tracks, clock, timeSignature = [4, 4], createContext = defaultContext, sound = SOUND_AUTO }) {
    super();
    this.tracks = tracks;
    this.clock = clock;
    this.sound = sound === SOUND_AUTO ? SOUND_AUTO : soundName(sound);
    this.events = buildEvents(tracks, clock);
    this.clicks = buildClicks(tracks[0] ? tracks[0].measures : [], clock, timeSignature);
    this.createContext = createContext;
    this.ctx = null;
    this.ready = false;
    this.playing = false;
    this.rate = 1;
    this.loop = null;
    this.offset = 0;
    this.click = false;
    this.position = 0;
    this.anchors = [];
    this.schedAnchor = null;
    this.frontier = 0;
    this.nextEvent = 0;
    this.nextClick = 0;
    this.endAt = null;
    this.voices = new Set();
    this.buffers = new Map();
    this.samples = new Map();
    this.gains = new Map();
    this.volumes = new Map(tracks.filter((track) => track.level !== undefined && track.level !== null).map((track) => [track.id, track.level]));
    this.timer = 0;
    this.raf = 0;
    this.warmTimer = 0;
    this.samplesRate = 0; // the rate the prewarmed samples were made for
    this.prewarmStop = null;
    this.cap = BUFFER_CAP;
    this.onVisibility = () => this.schedule(); // a tab going hidden fills the longer lookahead at once
  }

  async init() {
    this.ready = true;
    this.dispatchEvent(new CustomEvent('ready'));
    this.report();
  }

  get duration() {
    return this.clock.end;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const ctx = this.createContext();
    this.ctx = ctx;
    rememberRate(ctx.sampleRate);
    if (this.prewarmStop) this.prewarmStop();
    if (this.samplesRate && this.samplesRate !== ctx.sampleRate) this.samples.clear(); // guessed wrong: synthesized again at the real rate
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10; // a safety net for chords, not a squeeze: the plucks keep their attacks
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 2.5;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.3;
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
    this.room = roomNode(ctx);
    this.room.connect(this.master);
    for (const track of this.tracks) {
      const gain = ctx.createGain();
      gain.gain.value = (this.volumes.get(track.id) ?? 1) * (LEVEL[track.kind] || 1);
      this.gains.set(track.id, gain);
    }
    this.chains = new Map();
    this.wireTracks();
    this.clickGain = ctx.createGain();
    this.clickGain.gain.value = 0.5;
    this.clickGain.connect(this.master);
    this.warm();
    return ctx;
  }

  /** The sound a part plays with right now. */
  soundFor(track) {
    return resolveSound(this.sound, track.sound);
  }

  /** Connect each part's volume to a fresh chain (drive, body, room send) for the sound in force, tearing down the old one. */
  wireTracks() {
    for (const track of this.tracks) {
      const gain = this.gains.get(track.id);
      gain.disconnect();
      const old = this.chains.get(track.id);
      if (old) for (const node of old.nodes) node.disconnect();
      const chain = buildChain(this.ctx, { kind: track.kind, sound: this.soundFor(track), dry: this.master, wet: this.room });
      gain.connect(chain.input);
      this.chains.set(track.id, chain);
    }
  }

  /** Every buffer key the song plays with the sound in force. */
  songKeys() {
    return [...new Set(this.events.map((e) => bufferKey(e, this.sound)))];
  }

  /**
   * Synthesize the song's plucks while the page is idle, before any
   * AudioContext exists, so the first play does not stop to compute them.
   * Made at the guessed sample rate; a context at another rate discards them.
   */
  prewarm(sampleRate = guessRate()) {
    if (this.ctx || this.prewarmStop) return;
    this.samplesRate = sampleRate;
    const keys = this.songKeys().filter((key) => !this.samples.has(key));
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 30);
    const cancel = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout;
    let handle = 0;
    const step = () => {
      const started = performance.now();
      while (keys.length && performance.now() - started < 8) samplesFor(keys.shift(), sampleRate, this.samples);
      if (keys.length) handle = idle(step);
      else this.prewarmStop = null;
    };
    handle = idle(step);
    this.prewarmStop = () => {
      cancel(handle);
      this.prewarmStop = null;
    };
  }

  /** Build the buffers for every pitch in the song a few at a time, off the critical path (prewarmed samples make each one cheap). */
  warm() {
    clearTimeout(this.warmTimer);
    const keys = this.songKeys();
    this.cap = Math.max(BUFFER_CAP, keys.length + 8);
    const step = () => {
      for (let i = 0; i < 6 && keys.length; i++) this.bufferFor(keys.shift());
      if (keys.length) this.warmTimer = setTimeout(step, 30);
    };
    this.warmTimer = setTimeout(step, 0);
  }

  /** The AudioBuffer for a key, made on demand; the least recently used go once the cap is reached. */
  bufferFor(key) {
    let buffer = this.buffers.get(key);
    if (buffer) {
      this.buffers.delete(key); // the most recently used sits last
      this.buffers.set(key, buffer);
      return buffer;
    }
    const samples = samplesFor(key, this.ctx.sampleRate, this.samples);
    buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    this.samples.delete(key); // the AudioBuffer holds the copy; no need for two
    this.buffers.set(key, buffer);
    while (this.buffers.size > this.cap) this.buffers.delete(this.buffers.keys().next().value);
    return buffer;
  }

  clickBufferFor(accent) {
    const key = accent ? 'click:hi' : 'click:lo';
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const samples = clickBuffer(this.ctx.sampleRate, accent ? 1200 : 800);
      buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  /** Song time in seconds: the paused position, or the audio clock through the current anchor. */
  get time() {
    if (!this.playing || !this.ctx) return this.position;
    const now = this.ctx.currentTime;
    while (this.anchors.length > 1 && this.anchors[1].ctx <= now) this.anchors.shift();
    const anchor = this.anchors[0];
    return Math.max(anchor.song, anchor.song + (now - anchor.ctx) * this.rate);
  }

  ctxTime(song, anchor = this.schedAnchor) {
    return anchor.ctx + (song - anchor.song) / this.rate;
  }

  /** One frame: report the position; keep going only while playing (a paused page costs nothing). */
  tick() {
    this.raf = 0;
    if (!this.ready) return;
    if (this.playing && this.endAt !== null && this.ctx.currentTime >= this.endAt) {
      this.finish();
      return;
    }
    const time = this.time;
    const pos = this.clock.timeToBar(time);
    this.dispatchEvent(new CustomEvent('tick', { detail: { time, ...pos, playing: this.playing } }));
    if (this.playing) this.raf = requestAnimationFrame(() => this.tick());
  }

  /** A single report when something changed while paused, or the first frame of the loop. */
  report() {
    if (!this.raf) this.tick();
  }

  play() {
    if (this.playing) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended' && ctx.resume) {
      const resumed = ctx.resume();
      if (resumed && resumed.catch) resumed.catch(() => {});
    }
    if (this.position >= this.clock.end - 1e-6) this.position = this.loop ? this.loop.start : 0;
    this.playing = true;
    this.start(this.position);
    this.timer = setInterval(() => this.schedule(), SCHEDULE_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.dispatchEvent(new CustomEvent('state', { detail: { playing: true } }));
    this.report();
  }

  /** The buffers the first lookahead needs, built before the anchor is read, so their synthesis cannot push the first notes late. */
  prepare(song) {
    const until = song + LOOKAHEAD * this.rate;
    for (let i = lowerBound(this.events, song); i < this.events.length && this.events[i].t < until; i++) this.bufferFor(bufferKey(this.events[i], this.sound));
  }

  /** Anchor the schedule at a song time and fill the lookahead. */
  start(song) {
    this.stopVoices();
    this.prepare(song);
    const anchor = { ctx: this.ctx.currentTime + START_DELAY, song };
    this.anchors = [anchor];
    this.schedAnchor = anchor;
    this.frontier = song;
    this.nextEvent = lowerBound(this.events, song);
    this.nextClick = lowerBound(this.clicks, song);
    this.endAt = null;
    this.schedule();
  }

  schedule() {
    if (!this.playing) return;
    if (this.endAt !== null && this.ctx.currentTime >= this.endAt) {
      this.finish(); // also from the timer, so a song that ends in a hidden tab (no animation frames) still stops
      return;
    }
    const hidden = typeof document !== 'undefined' && document.hidden;
    const untilCtx = this.ctx.currentTime + (hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
    for (let guard = 0; guard < 8; guard++) {
      const anchor = this.schedAnchor;
      const untilSong = anchor.song + (untilCtx - anchor.ctx) * this.rate;
      const stopAt = this.loop ? this.loop.end : this.clock.end;
      const limit = Math.min(untilSong, stopAt);
      this.scheduleRange(this.frontier, limit, anchor);
      this.frontier = Math.max(this.frontier, limit);
      if (limit < stopAt) break;
      const wrapCtx = this.ctxTime(stopAt, anchor);
      if (!this.loop) {
        this.endAt = wrapCtx;
        break;
      }
      const next = { ctx: wrapCtx, song: this.loop.start };
      this.anchors.push(next);
      this.schedAnchor = next;
      this.frontier = this.loop.start;
      this.nextEvent = lowerBound(this.events, this.loop.start);
      this.nextClick = lowerBound(this.clicks, this.loop.start);
    }
    if (this.endAt !== null && this.ctx.currentTime >= this.endAt) this.finish(); // the end was reached while the clock ran on (a hidden tab)
  }

  scheduleRange(from, to, anchor) {
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].t < to) {
      const event = this.events[this.nextEvent++];
      if (event.t >= from - 1e-9) this.playEvent(event, anchor);
    }
    while (this.nextClick < this.clicks.length && this.clicks[this.nextClick].t < to) {
      const click = this.clicks[this.nextClick++];
      if (this.click && click.t >= from - 1e-9) this.playClick(click, anchor);
    }
  }

  playEvent(event, anchor) {
    const ctx = this.ctx;
    const at = this.ctxTime(event.t + (event.shift || 0), anchor);
    const dur = Math.max(0.03, (event.end - event.t) / this.rate);
    const buffer = this.bufferFor(bufferKey(event, this.sound));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const level = event.gain * (event.touch ?? 1);
    gain.gain.setValueAtTime(level, at);
    let stopAt = at + buffer.duration;
    if (dur < buffer.duration) {
      gain.gain.setValueAtTime(level, at + dur);
      gain.gain.linearRampToValueAtTime(0, at + dur + RELEASE);
      stopAt = at + dur + RELEASE + 0.01;
    }
    if (!event.dead) this.shapePitch(source, event, at, dur);
    source.connect(gain);
    gain.connect(this.gains.get(event.track) || this.master);
    source.start(at);
    source.stop(stopAt);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => this.voices.delete(voice);
  }

  /** Bends and slides as playback-rate ramps (exponential, so linear in pitch). */
  shapePitch(source, event, at, dur) {
    const rate = source.playbackRate;
    const cents = (c) => Math.pow(2, c / 1200);
    if (event.bend) {
      rate.setValueAtTime(1, at + Math.min(0.05, dur * 0.2));
      rate.exponentialRampToValueAtTime(cents(event.bend * 200), at + Math.min(0.35, dur * 0.7));
    } else if (event.slideTo !== null && event.slideTo !== event.midi) {
      rate.setValueAtTime(1, at + dur * 0.6);
      rate.exponentialRampToValueAtTime(cents((event.slideTo - event.midi) * 100), at + dur);
    } else if (event.slide === 'up' || event.slide === 'down') {
      rate.setValueAtTime(1, at + Math.max(0, dur - 0.12));
      rate.exponentialRampToValueAtTime(cents(event.slide === 'up' ? 500 : -500), at + dur);
    } else if (event.slide === 'above' || event.slide === 'below') {
      rate.setValueAtTime(cents(event.slide === 'above' ? 400 : -400), at);
      rate.exponentialRampToValueAtTime(1, at + Math.min(0.1, dur * 0.5));
    }
  }

  playClick(click, anchor) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.clickBufferFor(click.accent);
    source.connect(this.clickGain);
    const at = this.ctxTime(click.t, anchor);
    source.start(at);
    source.stop(at + source.buffer.duration);
    const voice = { source, gain: null };
    this.voices.add(voice);
    source.onended = () => this.voices.delete(voice);
  }

  stopVoices() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const { source, gain } of this.voices) {
      try {
        if (gain) {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.02);
        }
        source.stop(now + 0.03);
      } catch {
        /* already stopped */
      }
    }
    this.voices.clear();
  }

  pause() {
    if (!this.playing) return;
    this.position = Math.min(this.clock.end, this.time);
    this.playing = false;
    clearInterval(this.timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.endAt = null;
    this.stopVoices();
    this.dispatchEvent(new CustomEvent('state', { detail: { playing: false } }));
    this.report();
  }

  finish() {
    this.pause();
    this.position = this.clock.end;
    this.dispatchEvent(new CustomEvent('state', { detail: { playing: false, ended: true } }));
    this.report();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t) {
    const clamped = Math.max(0, Math.min(this.clock.end, t));
    if (this.playing) this.start(clamped);
    else {
      this.position = clamped;
      this.report();
    }
  }

  seekBar(bar, frac = 0) {
    this.seek(this.clock.barToTime(bar, frac));
  }

  setRate(rate) {
    const t = this.time;
    this.rate = rate;
    if (this.playing) this.start(t);
  }

  /** Loop a bar range [startBar, endBar] inclusive, or null to clear. */
  setLoop(range) {
    this.loop = range ? { start: this.clock.barToTime(range.startBar), end: this.clock.barToTime(range.endBar, 1) } : null;
    if (this.playing) this.start(this.time);
  }

  setVolume(trackId, value) {
    this.volumes.set(trackId, value);
    const gain = this.gains.get(trackId);
    if (!gain) return;
    const kind = this.tracks.find((t) => t.id === trackId)?.kind;
    gain.gain.setTargetAtTime(value * (LEVEL[kind] || 1), this.ctx.currentTime, 0.01);
  }

  getVolume(trackId) {
    return this.volumes.get(trackId) ?? 1;
  }

  setClick(on) {
    this.click = !!on;
  }

  /** Switch the guitar sound (a SOUNDS key, or SOUND_AUTO for each part's own). Notes already sounding keep the old one. */
  setSound(name) {
    const sound = name === SOUND_AUTO ? SOUND_AUTO : soundName(name);
    if (sound === this.sound) return;
    this.sound = sound;
    for (const key of [...this.buffers.keys()]) {
      if (key.startsWith('guitar:')) {
        this.buffers.delete(key);
        this.samples.delete(key);
      }
    }
    if (!this.ctx) return;
    this.wireTracks();
    this.warm();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    clearTimeout(this.warmTimer);
    if (this.prewarmStop) this.prewarmStop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.playing = false;
    this.stopVoices();
    if (this.ctx && this.ctx.close) this.ctx.close();
  }
}
