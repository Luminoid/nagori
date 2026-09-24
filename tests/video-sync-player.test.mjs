// Drives VideoSync with a fake YouTube player to check seeking, ticking and looping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakePlayer {
  constructor(el, options) {
    this.options = options;
    this.time = 0;
    this.rate = 1;
    this.calls = [];
    setTimeout(() => options.events.onReady({ target: this }), 0);
  }
  getCurrentTime() { return this.time; }
  getDuration() { return 260; }
  playVideo() { this.calls.push('play'); this.options.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.calls.push('pause'); this.options.events.onStateChange({ data: 2 }); }
  seekTo(t) { this.calls.push(['seek', t]); this.time = t; }
  setPlaybackRate(r) { this.rate = r; }
  destroy() {}
}

globalThis.window = { YT: { Player: FakePlayer }, location: { origin: 'http://localhost' } };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 5);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { VideoSync, BarClock } = await import('../js/video-sync.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('VideoSync seeks by bar with the offset removed and reports bars on tick', async () => {
  const clock = new BarClock([1, 3, 5, 7], { bpm: 120 });
  const sync = new VideoSync({ mount: {}, videoId: 'x', clock, offset: 0.5 });
  const ticks = [];
  sync.addEventListener('tick', (e) => ticks.push(e.detail));
  await sync.init();
  assert.equal(sync.ready, true);
  sync.seekBar(2, 0.5); // bar 2 starts at 5s, half a bar in = 6s, minus offset
  assert.deepEqual(sync.player.calls.at(-1), ['seek', 5.5]);
  await wait(30);
  const last = ticks.at(-1);
  assert.equal(last.bar, 2);
  assert.ok(Math.abs(last.frac - 0.5) < 1e-6);
  assert.equal(last.playing, false);
  sync.destroy();
});

test('VideoSync loops back to the section start when the range ends', async () => {
  const clock = new BarClock([1, 3, 5, 7], { bpm: 120 });
  const sync = new VideoSync({ mount: {}, videoId: 'x', clock });
  const states = [];
  sync.addEventListener('state', (e) => states.push(e.detail.playing));
  await sync.init();
  sync.setLoop({ startBar: 1, endBar: 2 }); // 3s .. 7s
  sync.play();
  assert.deepEqual(states, [true]);
  sync.player.time = 7.5; // past the loop end
  await wait(30);
  const seek = sync.player.calls.filter((c) => Array.isArray(c)).at(-1);
  assert.deepEqual(seek, ['seek', 3]);
  sync.pause();
  assert.deepEqual(states, [true, false]);
  sync.destroy();
});

test('VideoSync interpolates between player samples while playing', async () => {
  const clock = new BarClock([0, 2, 4], { bpm: 120 });
  const sync = new VideoSync({ mount: {}, videoId: 'x', clock });
  await sync.init();
  sync.play();
  sync.player.time = 1;
  const first = sync.time;
  await wait(50);
  const later = sync.time;
  assert.ok(later > first && later - first < 0.6, `interpolated ${first} -> ${later}`);
  sync.destroy();
});
