// Tab playback: the bar clock from the tempo map, note events, string synthesis,
// the offline mix, and the scheduler driven by a fake AudioContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeContext } from './helpers/fake-audio.mjs';

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 5);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { quarterBpm, tabBarTimes, tabClock, buildEvents, buildClicks, pluckBuffer, renderOffline, TabPlayer, timbre, driveCurve, driveSamples, soundName, DEFAULT_SOUND, SOUNDS, BODIES, buildChain, roomNode, roomFor, bodyFor } = await import('../js/tab-audio.js');

const STANDARD = [64, 59, 55, 50, 45, 40];
const q = (notes, extra = {}) => ({ d: [1, 4], t: 4, notes, ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('tabBarTimes follows time signatures and tempo changes', () => {
  const measures = [{ beats: [], sig: [4, 4] }, { beats: [], sig: [3, 4] }, { beats: [] }, { beats: [] }];
  const tempo = [{ bar: 0, pos: 0, bpm: 120, unit: 4 }, { bar: 3, pos: 0, bpm: 60, unit: 4 }];
  const { barTimes, end } = tabBarTimes(measures, { tempo });
  assert.deepEqual(barTimes, [0, 2, 3.5, 5]);
  assert.equal(end, 8); // bar 3 is 3/4 at 60 bpm: 3 s
  assert.equal(quarterBpm({ bpm: 92, unit: 2 }), 184);
  const cut = tabBarTimes([{ beats: [], sig: [2, 2] }], { tempo: [{ bar: 0, pos: 0, bpm: 92, unit: 2 }] });
  near(cut.end, (60 / 92) * 2);
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4], tempo }, measures);
  assert.equal(clock.end, 8);
  assert.equal(clock.duration(3), 3);
});

test('buildEvents ties, let-ring cuts, strums, dead notes and capo', () => {
  const measures = [
    { beats: [q([{ s: 5, f: 3 }]), q([{ s: 5, f: 3, tie: true }]), q([{ s: 5, f: 5 }], { ring: true }), q([{ s: 5, f: 7 }])], sig: [4, 4] },
    { beats: [q([{ s: 0, f: 0 }, { s: 1, f: 1 }, { s: 2, f: 0 }], { stroke: 'down' }), q([{ s: 3, f: 2, dead: true }]), { d: [1, 2], t: 2, rest: true, notes: [] }] },
  ];
  const track = { id: 'g', kind: 'guitar', strings: 6, tuning: STANDARD, capo: 2, measures };
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4] }, measures);
  const events = buildEvents([track], clock);
  const low = events.filter((e) => e.string === 5);
  assert.equal(low.length, 3); // the tied quarter did not sound again
  assert.equal(low[0].midi, 40 + 2 + 3);
  near(low[0].end, 1); // held through the tie
  assert.equal(low[1].ring, true);
  near(low[1].end, 1.5); // let ring, cut by the next pluck on the string
  near(low[2].end, 2);
  const strum = events.filter((e) => e.t >= 2 && e.t < 2.1 && !e.dead);
  assert.deepEqual(strum.map((e) => e.string), [2, 1, 0]); // low string first on a down stroke
  assert.ok(strum[0].t < strum[1].t && strum[1].t < strum[2].t);
  const dead = events.find((e) => e.dead);
  assert.ok(dead && dead.end - dead.t < 0.2);
  const times = events.map((e) => e.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('buildEvents marks slides to the next note on the string', () => {
  const measures = [{ beats: [q([{ s: 2, f: 5, slide: 'legato' }]), q([{ s: 2, f: 7 }]), q([{ s: 2, f: 9, bend: 1 }]), { d: [1, 4], t: 4, rest: true, notes: [] }], sig: [4, 4] }];
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4] }, measures);
  const [a, b, c] = buildEvents([{ id: 'g', kind: 'guitar', strings: 6, tuning: STANDARD, measures }], clock);
  assert.equal(a.slideTo, 55 + 7);
  assert.ok(b.gain < 1); // reached by the slide, not picked
  assert.equal(c.bend, 1);
});

test('buildEvents gives every note the same nuance on every build, within a few milliseconds, and alternates variants per string', () => {
  const measures = [
    { beats: [q([{ s: 5, f: 3 }]), q([{ s: 5, f: 5 }]), q([{ s: 5, f: 7 }]), q([{ s: 0, f: 0 }, { s: 1, f: 1 }, { s: 2, f: 0 }, { s: 3, f: 2 }], { stroke: 'down' })], sig: [4, 4] },
  ];
  const track = { id: 'g', kind: 'guitar', strings: 6, tuning: STANDARD, measures };
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4] }, measures);
  const events = buildEvents([track], clock);
  assert.deepEqual(events, buildEvents([track], clock));
  for (const e of events) {
    assert.ok(Math.abs(e.shift) <= 0.005 && e.t + e.shift >= 0, `shift ${e.shift} at ${e.t}`);
    assert.ok(e.touch > 0.87 && e.touch <= 1, `touch ${e.touch}`);
  }
  assert.ok(events.some((e) => e.shift !== 0) && new Set(events.map((e) => e.touch)).size > 1);
  assert.deepEqual(events.filter((e) => e.string === 5).map((e) => e.variant), [0, 1, 0]);
  const strum = events.filter((e) => e.t >= 1.5);
  assert.deepEqual(strum.map((e) => e.string), [3, 2, 1, 0]);
  const gaps = strum.slice(1).map((e, i) => e.t - strum[i].t);
  assert.ok(gaps.every((g) => g > 0.014 && g < 0.024), `stroke gaps ${gaps}`); // the written 18 ms, a little faster or slower
});

test('buildClicks gives one click per beat and two per 6/8 bar', () => {
  const measures = [{ beats: [], sig: [4, 4] }, { beats: [], sig: [6, 8] }];
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4] }, measures);
  const clicks = buildClicks(measures, clock).map((c) => [c.t, c.accent]);
  assert.deepEqual(clicks, [[0, true], [0.5, false], [1, false], [1.5, false], [2, true], [2.75, false]]);
});

/** Fundamental in Hz by autocorrelation over [from, to) seconds, searched between fmin and fmax. */
function pitchOf(samples, sr, from, to, fmin, fmax) {
  const start = Math.floor(from * sr);
  const end = Math.floor(to * sr);
  let bestLag = 0;
  let best = -Infinity;
  const corr = (lag) => {
    let sum = 0;
    for (let i = start; i + lag < end; i++) sum += samples[i] * samples[i + lag];
    return sum;
  };
  for (let lag = Math.floor(sr / fmax); lag <= Math.ceil(sr / fmin); lag++) {
    const c = corr(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  const [a, b, c] = [corr(bestLag - 1), best, corr(bestLag + 1)];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (bestLag + shift);
}

test('pluckBuffer rings at the requested pitch and decays', () => {
  const sr = 22050;
  const samples = pluckBuffer(220, sr, { seconds: 2, t60: 2 });
  const hz = pitchOf(samples, sr, 0.3, 0.8, 150, 300);
  assert.ok(Math.abs(hz - 220) < 2.2, `measured ${hz} Hz`);
  const rms = (from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (to - from));
  };
  assert.ok(rms(0, sr * 0.1) > rms(sr * 1.8, sr * 2) * 10, 'decays');
  assert.ok(samples.every((v) => Math.abs(v) <= 0.95 + 1e-6));
  const bass = pluckBuffer(41.2, sr, { seconds: 1.5, t60: 4, brightness: 0.35 });
  const low = pitchOf(bass, sr, 0.3, 1.2, 30, 60);
  assert.ok(Math.abs(low - 41.2) < 0.5, `bass measured ${low} Hz`);
  const high = pluckBuffer(1318.5, 44100, { seconds: 1, t60: 1.5 });
  const top = pitchOf(high, 44100, 0.1, 0.5, 1000, 1600);
  assert.ok(Math.abs(top - 1318.5) < 14, `high e measured ${top} Hz`);
});

test('the string model stays in tune with every loop filter and is silent at the pick-position harmonics', () => {
  const sr = 8000;
  // A period of exactly 100 samples with the pick a fifth of the way along: every fifth harmonic is cancelled.
  const s = pluckBuffer(80, sr, { seconds: 1, t60: 3, pick: 0.2, damping: 0.4, lowpass: 0.3, detune: 0 });
  const hz = pitchOf(s, sr, 0.1, 0.6, 60, 100);
  assert.ok(Math.abs(hz - 80) < 0.3, `measured ${hz} Hz`);
  const magnitude = (harmonic) => {
    // from 0.15 s on: the pluck's spike (rounded off by the knee) and the fade-in have passed, the loop is what rings
    let re = 0;
    let im = 0;
    for (let i = 1200; i < 5200; i++) {
      const phase = (2 * Math.PI * 80 * harmonic * i) / sr;
      re += s[i] * Math.cos(phase);
      im -= s[i] * Math.sin(phase);
    }
    return Math.hypot(re, im);
  };
  assert.ok(magnitude(5) < magnitude(4) * 0.05 && magnitude(5) < magnitude(6) * 0.05, `harmonic 5 ${magnitude(5)} vs 4 ${magnitude(4)} and 6 ${magnitude(6)}`);
  for (const sound of Object.keys(SOUNDS)) {
    for (const f of [82.41, 329.63, 1046.5]) {
      const buffer = pluckBuffer(f, sr * 5.5125, { ...timbre('guitar', f, sound), seconds: 0.8 });
      assert.ok(buffer.every(Number.isFinite), `${sound} at ${f} Hz is finite`);
      // once the attack's glide has settled (under a cent by a quarter second) and while the note is still loud enough to measure at the
      // top of the range; a palm-muted note is gone within a tenth of a second, so it is measured mid-glide
      const [window, cents] = sound === 'muted' ? [[0.01, 0.08], 6] : [[0.25, 0.45], 3];
      const measured = pitchOf(buffer, sr * 5.5125, window[0], window[1], f * 0.9, f * 1.1);
      assert.ok(Math.abs(1200 * Math.log2(measured / f)) < cents, `${sound} at ${f} Hz measured ${measured}`);
    }
  }
});

test('the attack starts sharp and settles, two seeds give two plucks, and the soft layer is darker', () => {
  const sr = 44100;
  const glided = pluckBuffer(220, sr, { seconds: 1, t60: 2, glide: 12, detune: 0 });
  const early = pitchOf(glided, sr, 0.005, 0.045, 200, 240);
  const late = pitchOf(glided, sr, 0.5, 0.9, 200, 240);
  assert.ok(1200 * Math.log2(early / late) > 5, `early ${early} Hz vs late ${late} Hz`);
  assert.ok(Math.abs(1200 * Math.log2(late / 220)) < 1, `settled at ${late} Hz`);
  const one = pluckBuffer(220, sr, { seconds: 0.5, seed: 1, pickNoise: 0.1 });
  const two = pluckBuffer(220, sr, { seconds: 0.5, seed: 2, pickNoise: 0.1 });
  assert.notDeepEqual(Array.from(one.slice(0, 400)), Array.from(two.slice(0, 400)));
  assert.ok(one.every((v) => Math.abs(v) < 0.95) && two.every((v) => Math.abs(v) < 0.95), 'the knee keeps the spike under 0.95');
  const rms = (buf, from, to) => Math.sqrt(buf.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from));
  assert.ok(Math.abs(20 * Math.log10(rms(one, 0, 882) / 0.2)) < 1, 'levelled by the attack, not the peak');
  const full = timbre('guitar', 220, 'acoustic');
  const soft = timbre('guitar', 220, 'acoustic', 'soft');
  assert.ok(soft.brightness < full.brightness && soft.glide < full.glide && soft.pickNoise < full.pickNoise);
  assert.equal(soft.t60, full.t60);
});

test('renderOffline adds the room after the body filters and can leave it out', () => {
  const sr = 8000;
  const events = [{ t: 0, end: 0.3, track: 'g', kind: 'guitar', midi: 64, gain: 1 }];
  const wet = renderOffline(events, sr, { from: 0, to: 1.2 });
  const dry = renderOffline(events, sr, { from: 0, to: 1.2, reverb: false });
  const energy = (s, from, to) => s.slice(Math.floor(from * sr), Math.floor(to * sr)).reduce((a, v) => a + v * v, 0);
  assert.ok(energy(dry, 0.36, 0.5) > 1e-6 && energy(dry, 0.36, 0.5) < energy(dry, 0, 0.3) * 0.05, 'the body rings on after the note stops at 0.35 s');
  assert.ok(energy(dry, 0.55, 0.7) < 1e-9, 'and has rung out with the body response');
  assert.ok(energy(wet, 0.55, 0.7) > 1e-7 && energy(wet, 0.55, 0.7) > energy(dry, 0.55, 0.7) * 100, 'while the room still rings');
  assert.ok(energy(wet, 0, 0.3) > energy(wet, 0.55, 0.7) * 20, 'quietly');
  assert.equal(roomFor(sr), roomFor(sr), 'the room is built once per sample rate');
  assert.equal(bodyFor('steel', sr), bodyFor('steel', sr), 'so is a body');
  assert.equal(bodyFor('pickup', sr), null, 'and a pickup has none');
});

test('buildChain wires drive, body and a room send per sound, and roomNode carries the impulse', () => {
  const ctx = new FakeContext();
  const room = roomNode(ctx);
  assert.equal(room.normalize, false);
  assert.equal(room.buffer.duration, roomFor(ctx.sampleRate)[0].length / ctx.sampleRate);
  const clean = buildChain(ctx, { kind: 'guitar', sound: 'acoustic', dry: ctx.createGain(), wet: room });
  assert.equal(ctx.shapers.length, 0);
  assert.equal(ctx.convolvers.length, 2, 'the room and the steel body');
  assert.equal(ctx.convolvers[1].normalize, false);
  assert.equal(ctx.convolvers[1].buffer.duration, bodyFor('steel', ctx.sampleRate).length / ctx.sampleRate);
  assert.equal(ctx.filters.length, BODIES.steel.eq.length);
  assert.equal(ctx.filters[1].gain.value, BODIES.steel.eq[1].gain);
  assert.equal(clean.nodes.length, 1 + 1 + BODIES.steel.eq.length + 1);
  const driven = buildChain(ctx, { kind: 'guitar', sound: 'overdrive', dry: ctx.createGain() });
  assert.equal(ctx.shapers.length, 1);
  assert.equal(ctx.convolvers.length, 2, 'a pickup has no body response');
  assert.equal(driven.nodes.length, 1 + 2 + BODIES.pickup.eq.length);
  const bass = buildChain(ctx, { kind: 'bass', sound: 'overdrive', dry: ctx.createGain(), wet: room });
  assert.equal(ctx.shapers.length, 1, 'the bass never drives');
  assert.equal(bass.nodes.length, 1 + BODIES.bass.eq.length + 1);
});

test('renderOffline mixes a real song excerpt into finite samples', async () => {
  // The example song, so the test holds for a fork that replaced the collection.
  const base = new URL('../examples/twelve-bar-blues/', import.meta.url);
  const song = JSON.parse(await readFile(new URL('song.json', base), 'utf8'));
  const tracks = await Promise.all(
    song.tracks.map(async (meta) => ({ ...JSON.parse(await readFile(new URL(meta.file, base), 'utf8')), id: meta.id, kind: meta.kind, capo: meta.capo || 0 })),
  );
  const clock = tabClock(song, tracks[0].measures);
  near(clock.barToTime(1), (4 * 60) / song.bpm);
  const events = buildEvents(tracks, clock);
  assert.ok(events.length > 50);
  const sr = 8000;
  const mix = renderOffline(events, sr, { from: 0, to: 4 });
  assert.equal(mix.length, 4 * sr);
  assert.ok(mix.every(Number.isFinite));
  let energy = 0;
  for (let i = 0; i < sr; i++) energy += mix[i] * mix[i];
  assert.ok(energy > 1, 'the first second has sound');
  const muted = renderOffline(events, sr, { from: 0, to: 4, volumes: new Map(song.tracks.map((t) => [t.id, 0])) });
  assert.ok(muted.every((v) => v === 0));
});

// --- Player with a fake AudioContext --------------------------------------------

function makePlayer() {
  const bar = () => ({ beats: [q([{ s: 0, f: 0 }]), q([{ s: 1, f: 0 }]), q([{ s: 2, f: 0 }]), q([{ s: 3, f: 0 }])] });
  const measures = [{ ...bar(), sig: [4, 4] }, bar(), bar(), bar()]; // 4 bars of 2 s at 120 bpm
  const track = { id: 'g', kind: 'guitar', strings: 6, tuning: STANDARD, measures };
  const clock = tabClock({ bpm: 120, timeSignature: [4, 4] }, measures);
  const ctx = new FakeContext();
  const player = new TabPlayer({ tracks: [track], clock, createContext: () => ctx });
  return { player, ctx, clock };
}

test('TabPlayer schedules notes ahead of the clock and reports bars on tick', async () => {
  const { player, ctx } = makePlayer();
  await player.init();
  const ticks = [];
  const states = [];
  player.addEventListener('tick', (e) => ticks.push(e.detail));
  player.addEventListener('state', (e) => states.push(e.detail));
  player.play();
  assert.deepEqual(states, [{ playing: true }]);
  assert.equal(ctx.sources.length, 1); // only the note at 0 falls inside the first lookahead
  near(ctx.sources[0].startAt, 0.06, 0.006); // within the hand's few milliseconds
  ctx.currentTime = 1.06; // one second in: song time 1.0
  player.schedule();
  assert.equal(ctx.sources.length, 3); // notes at 0, 0.5 and 1.0
  await wait(25);
  const last = ticks.at(-1);
  assert.equal(last.bar, 0);
  near(last.frac, 0.5, 1e-6);
  assert.equal(last.playing, true);
  player.pause();
  near(player.time, 1);
  assert.equal(states.at(-1).playing, false);
  assert.ok(ctx.sources.every((s) => s.stopAt !== undefined));
  player.destroy();
});

test('TabPlayer loops across the wrap, follows speed changes and seeks', async () => {
  const { player, ctx } = makePlayer();
  await player.init();
  player.setLoop({ startBar: 1, endBar: 1 }); // 2 s .. 4 s
  player.seekBar(1, 0.9); // 3.8 s
  player.play();
  // The lookahead reaches the loop end: the note at the loop start is scheduled at ctx 0.06 + 0.2.
  assert.ok(ctx.sources.some((s) => Math.abs(s.startAt - 0.26) < 0.006));
  ctx.currentTime = 0.3;
  near(player.time, 2.04);
  player.setRate(0.5); // re-anchors 2.04 at ctx 0.36
  ctx.currentTime = 1.36; // one real second later is half a song second
  near(player.time, 2.54);
  player.seek(0);
  ctx.currentTime += 0.06;
  near(player.time, 0);
  player.destroy();
});

test('TabPlayer ends at the last bar and restarts from the top', async () => {
  const { player, ctx, clock } = makePlayer();
  await player.init();
  const states = [];
  player.addEventListener('state', (e) => states.push(e.detail));
  player.seek(clock.end - 0.1);
  player.play();
  near(player.endAt, 0.16);
  ctx.currentTime = 0.2;
  await wait(25);
  assert.equal(player.playing, false);
  assert.equal(player.position, clock.end);
  assert.deepEqual(states.at(-1), { playing: false, ended: true });
  player.play();
  assert.equal(player.time, 0);
  player.destroy();
});

test('TabPlayer volumes and clicks', async () => {
  const { player, ctx } = makePlayer();
  await player.init();
  player.setVolume('g', 0);
  player.setClick(true);
  player.play();
  const trackGain = player.gains.get('g');
  assert.equal(trackGain.gain.value, 0);
  player.setVolume('g', 1);
  near(trackGain.gain.value, 0.8); // guitars sit a little under the bass
  const clicks = ctx.sources.filter((s) => s.buffer && s.buffer.duration < 0.1);
  assert.equal(clicks.length, 1); // the downbeat click inside the first lookahead
  player.destroy();
});

// --- Guitar sounds ------------------------------------------------------------

test('guitar sounds change the pluck timbre and the bass keeps its own', () => {
  const acoustic = timbre('guitar', 220);
  const nylon = timbre('guitar', 220, 'nylon');
  const muted = timbre('guitar', 220, 'muted');
  const drive = timbre('guitar', 220, 'overdrive');
  assert.ok(nylon.brightness < acoustic.brightness);
  assert.ok(muted.t60 < acoustic.t60 * 0.2);
  assert.ok(drive.t60 > acoustic.t60);
  assert.deepEqual(timbre('guitar', 220, 'nonsense'), acoustic);
  assert.deepEqual(timbre('bass', 55, 'overdrive'), timbre('bass', 55));
  assert.equal(soundName('electric'), 'electric');
  assert.equal(soundName('x'), DEFAULT_SOUND);
});

test('the drive stage clips softly and sustains the tail', () => {
  const curve = driveCurve(0.7);
  assert.ok(curve.every((v) => Math.abs(v) <= 0.45 + 1e-6));
  assert.ok(curve[0] < 0 && curve[curve.length - 1] > 0 && Math.abs(curve[Math.floor(curve.length / 2)]) < 0.01);
  const sr = 8000;
  const samples = pluckBuffer(220, sr, { seconds: 1, t60: 1 });
  const driven = driveSamples(samples, 0.7, sr);
  const rms = (buf, from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / (to - from));
  };
  // Relative to its own attack, the driven tail is louder than the clean one.
  const cleanTail = rms(samples, sr * 0.6, sr * 0.8) / rms(samples, 0, sr * 0.1);
  const drivenTail = rms(driven, sr * 0.6, sr * 0.8) / rms(driven, 0, sr * 0.1);
  assert.ok(drivenTail > cleanTail * 1.5, `driven ${drivenTail} vs clean ${cleanTail}`);
  assert.ok(driven.every((v) => Math.abs(v) <= 0.45 + 1e-6));
});

test('renderOffline takes a sound and drives guitar parts only', () => {
  const sr = 8000;
  const events = [
    { t: 0, end: 1, track: 'g', kind: 'guitar', midi: 57, gain: 1 },
    { t: 0, end: 1, track: 'b', kind: 'bass', midi: 33, gain: 1 },
  ];
  const clean = renderOffline(events, sr, { from: 0, to: 1 });
  const driven = renderOffline(events, sr, { from: 0, to: 1, sound: 'overdrive' });
  assert.ok(clean.every(Number.isFinite) && driven.every(Number.isFinite));
  assert.notDeepEqual(Array.from(driven.slice(100, 200)), Array.from(clean.slice(100, 200)));
  const bassOnly = (sound) => renderOffline(events, sr, { from: 0, to: 1, sound, volumes: new Map([['g', 0]]) });
  assert.deepEqual(Array.from(bassOnly('overdrive')), Array.from(bassOnly('acoustic')));
});

test('TabPlayer.setSound rebuilds the guitar buffers and the drive chain', async () => {
  const { player, ctx } = makePlayer();
  await player.init();
  player.play();
  assert.ok([...player.buffers.keys()].some((k) => k.endsWith(':acoustic')));
  assert.equal(ctx.shapers.length, 0);
  player.setSound('overdrive');
  assert.equal(player.sound, 'overdrive');
  assert.ok([...player.buffers.keys()].every((k) => !k.endsWith(':acoustic')));
  await new Promise((r) => setTimeout(r, 5)); // the warm-up runs off the click handler
  assert.ok([...player.buffers.keys()].some((k) => k.endsWith(':overdrive')));
  assert.equal(ctx.shapers.length, 1);
  assert.ok(ctx.shapers[0].curve instanceof Float32Array);
  ctx.currentTime = 1.06;
  player.schedule();
  assert.ok(ctx.sources.length >= 3);
  player.setSound('bogus'); // unknown names fall back to the default
  assert.equal(player.sound, DEFAULT_SOUND);
  player.destroy();
});

test('prewarm synthesizes the plucks before any context exists, and the buffer cache keeps the most recently used', async () => {
  const { player, ctx } = makePlayer();
  player.prewarm(ctx.sampleRate);
  assert.ok(player.prewarmStop, 'prewarm is under way');
  for (let i = 0; i < 40 && player.prewarmStop; i++) await new Promise((r) => setTimeout(r, 35));
  assert.equal(player.prewarmStop, null, 'prewarm finished');
  const keys = player.songKeys();
  assert.ok(keys.length >= 4);
  for (const key of keys) assert.ok(player.samples.has(key), `${key} prewarmed`);
  assert.equal(player.samplesRate, ctx.sampleRate);
  player.ensureContext();
  assert.equal(player.samples.size, keys.length, 'a context at the guessed rate keeps the samples');
  player.bufferFor(keys[0]);
  assert.equal(player.samples.size, keys.length - 1, 'a buffer takes over its samples');
  player.cap = 2;
  player.bufferFor(keys[1]);
  player.bufferFor(keys[0]); // used again: stays
  player.bufferFor(keys[2]);
  assert.deepEqual([...player.buffers.keys()], [keys[0], keys[2]], 'the least recently used buffer went');
  player.destroy();

  const other = makePlayer();
  other.player.prewarm(other.ctx.sampleRate * 2);
  for (let i = 0; i < 40 && other.player.prewarmStop; i++) await new Promise((r) => setTimeout(r, 35));
  assert.ok(other.player.samples.size > 0);
  other.player.ensureContext();
  assert.equal(other.player.samples.size, 0, 'a context at another rate discards the guess');
  other.player.destroy();
});

test('the timer ends a song whose last notes pass while no frame is drawn', async () => {
  const { player, ctx, clock } = makePlayer();
  await player.init();
  const states = [];
  player.addEventListener('state', (e) => states.push(e.detail));
  player.play();
  ctx.currentTime = clock.end + 1; // the song is over, as after a while in a hidden tab
  player.schedule();
  assert.equal(player.playing, false);
  assert.ok(states.some((s) => s.ended), 'finish was reported');
  player.destroy();
});
