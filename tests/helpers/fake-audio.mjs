// A minimal AudioContext stand-in for scheduler tests: time is advanced by hand.

export class FakeParam {
  constructor(value) {
    this.value = value;
    this.log = [];
  }
  setValueAtTime(v, t) {
    this.log.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v, t) {
    this.log.push(['ramp', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.log.push(['exp', v, t]);
  }
  setTargetAtTime(v, t) {
    this.log.push(['target', v, t]);
    this.value = v;
  }
  cancelScheduledValues() {}
}

export class FakeContext {
  constructor({ sampleRate = 8000 } = {}) {
    this.currentTime = 0;
    this.sampleRate = sampleRate;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
    this.gains = [];
    this.shapers = [];
    this.filters = [];
    this.convolvers = [];
  }
  createGain() {
    const node = { gain: new FakeParam(1), connect() {}, disconnect() {} };
    this.gains.push(node);
    return node;
  }
  createDynamicsCompressor() {
    return { threshold: new FakeParam(0), knee: new FakeParam(0), ratio: new FakeParam(1), attack: new FakeParam(0), release: new FakeParam(0), connect() {} };
  }
  createWaveShaper() {
    const node = { curve: null, oversample: 'none', connect() {}, disconnect() {} };
    this.shapers.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0), connect() {}, disconnect() {} };
    this.filters.push(node);
    return node;
  }
  createConvolver() {
    const node = { buffer: null, normalize: true, connect() {}, disconnect() {} };
    this.convolvers.push(node);
    return node;
  }
  createBuffer(channels, length, sampleRate) {
    return { duration: length / sampleRate, copyToChannel() {} };
  }
  createBufferSource() {
    const source = { buffer: null, playbackRate: new FakeParam(1), connect() {}, onended: null, start(t) { source.startAt = t; }, stop(t) { source.stopAt = t; } };
    this.sources.push(source);
    return source;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
