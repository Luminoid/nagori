// Metronome on the Web Audio clock: a lookahead scheduler places clicks a
// fraction of a second ahead, and 'tick' events fire when each click sounds.

import { clickBuffer } from './tab-audio.js';

const LOOKAHEAD = 0.15;
const HIDDEN_LOOKAHEAD = 1.5; // a hidden tab's timers run once a second at best; the clicks are placed further ahead there
const INTERVAL_MS = 25;
const START_DELAY = 0.08;
const LEVELS = { accent: 1, beat: 0.7, sub: 0.35 };
const FREQS = { accent: 1200, beat: 900, sub: 650 };

function defaultContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  return new Context({ latencyHint: 'interactive' });
}

export class Metronome extends EventTarget {
  constructor({ createContext = defaultContext } = {}) {
    super();
    this.createContext = createContext;
    this.ctx = null;
    this.bpm = 100;
    this.beats = 4;
    this.subdivision = 1;
    this.accent = true;
    this.volume = 0.8;
    this.running = false;
    this.nextTime = 0;
    this.beat = 0;
    this.sub = 0;
    this.queue = [];
    this.timer = 0;
    this.raf = 0;
    this.buffers = new Map();
    this.sources = new Set(); // clicks scheduled but not yet sounded, stopped with the metronome
    this.onVisibility = () => this.schedule();
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = this.createContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  bufferFor(kind) {
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      const samples = clickBuffer(this.ctx.sampleRate, FREQS[kind]);
      buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(kind, buffer);
    }
    return buffer;
  }

  start() {
    if (this.running) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended' && ctx.resume) {
      const resumed = ctx.resume();
      if (resumed && resumed.catch) resumed.catch(() => {});
    }
    this.running = true;
    this.beat = 0;
    this.sub = 0;
    this.queue = [];
    this.nextTime = ctx.currentTime + START_DELAY;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), INTERVAL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.watch();
    this.dispatchEvent(new CustomEvent('state', { detail: { running: true } }));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    const now = this.ctx.currentTime;
    for (const source of this.sources) {
      try {
        source.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.queue = [];
    this.dispatchEvent(new CustomEvent('state', { detail: { running: false } }));
  }

  toggle() {
    if (this.running) this.stop();
    else this.start();
  }

  schedule() {
    if (!this.running) return;
    const ahead = typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
    while (this.nextTime < this.ctx.currentTime + ahead) {
      const kind = this.sub !== 0 ? 'sub' : this.beat === 0 && this.accent ? 'accent' : 'beat';
      this.play(kind, this.nextTime);
      this.queue.push({ time: this.nextTime, beat: this.beat, sub: this.sub, kind });
      this.advance();
    }
  }

  advance() {
    this.nextTime += 60 / this.bpm / this.subdivision;
    this.sub += 1;
    if (this.sub >= this.subdivision) {
      this.sub = 0;
      this.beat = (this.beat + 1) % this.beats;
    }
  }

  play(kind, time) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.bufferFor(kind);
    const gain = this.ctx.createGain();
    gain.gain.value = LEVELS[kind];
    source.connect(gain);
    gain.connect(this.gain);
    source.start(time);
    source.stop(time + source.buffer.duration);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Emit 'tick' for every scheduled click whose time has come. */
  flush() {
    const now = this.ctx.currentTime;
    while (this.queue.length && this.queue[0].time <= now) {
      this.dispatchEvent(new CustomEvent('tick', { detail: this.queue.shift() }));
    }
  }

  watch() {
    this.raf = requestAnimationFrame(() => this.watch());
    this.flush();
  }

  setBpm(bpm) {
    if (!Number.isFinite(bpm)) return; // an empty or half-typed field keeps the tempo
    this.bpm = Math.min(300, Math.max(20, Math.round(bpm)));
  }

  setBeats(beats) {
    this.beats = Math.max(1, beats);
    if (this.beat >= this.beats) this.beat = 0;
  }

  setSubdivision(subdivision) {
    this.subdivision = Math.max(1, subdivision);
    this.sub = 0;
  }

  setAccent(on) {
    this.accent = !!on;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.gain) this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
  }
}

/** Tempo from taps: the mean of the last intervals, reset after a pause. */
export class TapTempo {
  constructor({ resetAfter = 2500, window = 8 } = {}) {
    this.resetAfter = resetAfter;
    this.window = window;
    this.taps = [];
  }

  tap(now = performance.now()) {
    if (this.taps.length && now - this.taps[this.taps.length - 1] > this.resetAfter) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > this.window + 1) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return Math.round(60000 / (span / (this.taps.length - 1)));
  }

  reset() {
    this.taps = [];
  }
}
