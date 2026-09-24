// YouTube playback clock: maps video time to bars using per-bar sync points.

let apiPromise = null;

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => reject(new Error('YouTube player failed to load'));
      document.head.append(script);
      setTimeout(() => reject(new Error('YouTube player timed out')), 15000);
    });
    apiPromise.catch(() => {
      apiPromise = null; // a failure is not remembered: the next player tries the API again
    });
  }
  return apiPromise;
}

/** Bar <-> time mapping from a list of bar start times (seconds). */
export class BarClock {
  /** `end`: when the last bar ends; defaults to one more bar at the previous bar's length. */
  constructor(barTimes, { bpm = 120, timeSignature = [4, 4], end = null } = {}) {
    this.barTimes = barTimes;
    const nominal = (60 / bpm) * timeSignature[0] * (4 / timeSignature[1]);
    const n = barTimes.length;
    this.lastDuration = n >= 2 ? barTimes[n - 1] - barTimes[n - 2] : nominal;
    if (end !== null && n && end > barTimes[n - 1]) this.lastDuration = end - barTimes[n - 1];
    this.end = n ? barTimes[n - 1] + this.lastDuration : 0;
  }

  get bars() {
    return this.barTimes.length;
  }

  duration(bar) {
    const next = this.barTimes[bar + 1];
    return next !== undefined ? next - this.barTimes[bar] : this.lastDuration;
  }

  barToTime(bar, frac = 0) {
    const b = Math.max(0, Math.min(this.bars - 1, bar));
    return this.barTimes[b] + this.duration(b) * frac;
  }

  /** Returns { bar, frac, before, after }. before: time is ahead of bar 1. */
  timeToBar(t) {
    const times = this.barTimes;
    if (!times.length) return { bar: 0, frac: 0, before: true, after: false };
    if (t < times[0]) return { bar: 0, frac: 0, before: true, after: false };
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const dur = this.duration(lo);
    const frac = dur > 0 ? (t - times[lo]) / dur : 0;
    return { bar: lo, frac: Math.min(1, Math.max(0, frac)), before: false, after: frac >= 1 };
  }
}

const YT_PLAYING = 1;
const YT_ENDED = 0;

/**
 * Wraps a YouTube player. Emits 'tick' { time, bar, frac } every animation
 * frame while mounted, and 'state' { playing } on play/pause.
 */
export class VideoSync extends EventTarget {
  constructor({ mount, videoId, clock, offset = 0 }) {
    super();
    this.mount = mount;
    this.videoId = videoId;
    this.clock = clock;
    this.offset = offset;
    this.player = null;
    this.ready = false;
    this.playing = false;
    this.rate = 1;
    this.loop = null;
    this.lastRaw = 0;
    this.lastRawAt = 0;
    this.raf = 0;
    this.lastEmit = null;
  }

  async init() {
    const YT = await loadYouTubeAPI();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('YouTube player timed out')), 20000);
      this.player = new YT.Player(this.mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId: this.videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            clearTimeout(timer);
            this.ready = true;
            resolve();
          },
          onError: (e) => {
            clearTimeout(timer);
            this.dispatchEvent(new CustomEvent('error', { detail: e.data }));
            reject(new Error(`YouTube player error ${e.data}`));
          },
          onStateChange: (e) => this.onState(e.data),
          onPlaybackRateChange: (e) => {
            this.rate = e.data;
          },
        },
      });
    });
    this.dispatchEvent(new CustomEvent('ready'));
    this.report();
  }

  onState(state) {
    const playing = state === YT_PLAYING;
    const ended = state === YT_ENDED;
    if (playing !== this.playing || ended) {
      this.playing = playing;
      this.dispatchEvent(new CustomEvent('state', { detail: { playing, ended } }));
    }
    this.report();
  }

  /** Interpolated playback time in seconds, with the user's sync offset applied. */
  get time() {
    if (!this.ready) return 0;
    const raw = this.player.getCurrentTime() || 0;
    const now = performance.now();
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.lastRawAt = now;
    }
    const drift = this.playing ? Math.min(0.6, ((now - this.lastRawAt) / 1000) * this.rate) : 0;
    return raw + drift + this.offset;
  }

  get duration() {
    return this.ready ? this.player.getDuration() || 0 : 0;
  }

  /** One frame: report the position; keep going only while playing. */
  tick() {
    this.raf = 0;
    if (!this.ready) return;
    const time = this.time;
    if (this.loop && this.playing && time >= this.loop.end) this.seek(this.loop.start);
    else {
      const pos = this.clock.timeToBar(time);
      this.dispatchEvent(new CustomEvent('tick', { detail: { time, ...pos, playing: this.playing } }));
    }
    if (this.playing) this.raf = requestAnimationFrame(() => this.tick());
  }

  /** A single report when something changed while paused, or the first frame of the loop. */
  report() {
    if (!this.raf) this.tick();
  }

  play() {
    this.player?.playVideo();
  }

  pause() {
    this.player?.pauseVideo();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t) {
    if (!this.ready) return;
    this.player.seekTo(Math.max(0, t - this.offset), true);
    this.lastRaw = -1;
    if (!this.playing) {
      this.report();
      setTimeout(() => this.report(), 250); // the player reports the new time a moment later
    }
  }

  seekBar(bar, frac = 0) {
    this.seek(this.clock.barToTime(bar, frac));
  }

  setRate(rate) {
    this.rate = rate;
    this.player?.setPlaybackRate(rate);
  }

  /** Loop a bar range [startBar, endBar] inclusive, or null to clear. */
  setLoop(range) {
    if (!range) {
      this.loop = null;
      return;
    }
    this.loop = { start: this.clock.barToTime(range.startBar), end: this.clock.barToTime(range.endBar, 1) - 0.02 };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.player?.destroy();
  }
}
