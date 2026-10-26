import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {EmotionMusicEngine} from '../static/music-engine.mjs';
import {musicParameters, MUSIC_LAYERS} from '../static/music-math.mjs';
import {loadOrchestraSamples} from '../static/music-samples.mjs';

class Parameter {
  constructor(value = 0) { this.value = value; this.changes = 0; }
  cancelAndHoldAtTime() { this.changes++; }
  cancelScheduledValues() { this.changes++; }
  setValueAtTime(value) { this.value = value; this.changes++; }
  setTargetAtTime(value) { this.value = value; this.changes++; }
  linearRampToValueAtTime(value) { this.value = value; this.changes++; }
  exponentialRampToValueAtTime(value) { this.value = value; this.changes++; }
}
class Node {
  constructor() {
    for (const name of ['gain', 'frequency', 'detune', 'playbackRate', 'pan', 'delayTime', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new Parameter();
    this.disconnected = false;
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  setPeriodicWave(wave) { this.wave = wave; }
  start(time, offset) { this.started = time; this.offset = offset; }
  stop(time) { this.stopped = time; }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.sampleRate = 100; this.state = 'suspended'; this.nodes = []; this.destination = new Node(); }
  node() { const value = new Node(); this.nodes.push(value); return value; }
  createDynamicsCompressor() { return this.node(); }
  createGain() { return this.node(); }
  createWaveShaper() { return this.node(); }
  createConvolver() { return this.node(); }
  createDelay() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createOscillator() { return this.node(); }
  createPeriodicWave(real, imaginary) { return {real, imaginary}; }
  createBufferSource() { return this.node(); }
  createBuffer(channels, length, sampleRate = this.sampleRate) {
    const data = Array.from({length: channels}, () => new Float32Array(length));
    return {getChannelData: channel => data[channel], duration: length / sampleRate, sampleRate, numberOfChannels: channels, length};
  }
  async decodeAudioData() {
    const buffer = this.createBuffer(2, 400);
    for (let channel = 0; channel < 2; channel++)
      buffer.getChannelData(channel).set(Float32Array.from({length: 400}, (_, index) => (index / 400 - .5) * (channel ? -1 : 1)));
    return buffer;
  }
  async resume() { if (this.state === 'closed') throw new Error('closed'); this.state = 'running'; this.onstatechange?.(); }
  async suspend() { if (this.state === 'closed') throw new Error('closed'); this.state = 'suspended'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; this.onstatechange?.(); }
}
const originalFetch = globalThis.fetch;
const fixtureManifest = {version: 1, library: 'Fixture recording bank', instruments: Object.fromEntries(['violin', 'cello', 'horn', 'trombone'].map(instrument => [instrument,
  Array.from({length: 19}, (_, index) => ({url: `./${instrument}-${36 + index * 3}.wav`, midi: 36 + index * 3, velocity: .5, loopStartSeconds: .5, loopEndSeconds: 3, gain: 1})),
]))};
before(() => { globalThis.fetch = async () => ({ok: true, json: async () => fixtureManifest, arrayBuffer: async () => new ArrayBuffer(8)}); });
after(() => { globalThis.fetch = originalFetch; });
function changes(context) {
  return context.nodes.reduce((total, node) => total + Object.values(node).filter(value => value instanceof Parameter).reduce((sum, value) => sum + value.changes, 0), 0);
}

test('engine lifecycle does not create audio or emit until explicit start/control', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  let changes = 0;
  const engine = new EmotionMusicEngine({onChange: () => { changes++; }});
  try {
    assert.equal(engine._context, null); assert.equal(changes, 0);
    assert.equal(engine.getStatus().playing, false);
    await engine.start(); assert.equal(engine.getStatus().playing, true);
    assert.equal(engine.getStatus().sampleStatus, 'ready'); assert.ok(engine.getStatus().sampleCount > 0);
    await engine.pause(); assert.equal(engine.getStatus().playing, false); assert.equal(engine.getStatus().activeVoices, 0);
    assert.equal(engine.getStatus().contextState, 'suspended');
    await engine.start(); assert.equal(engine.getStatus().playing, true);
    await engine.dispose(); assert.equal(engine.getStatus().contextState, 'closed'); assert.equal(engine._timer, null);
    await assert.rejects(engine.start(), /已经关闭/);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('repeated WebSocket targets do not stack gain/filter automation', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start();
    const target = musicParameters({happiness: .7, neutral: .3});
    engine.setTarget(target); const initial = changes(engine._context);
    for (let i = 0; i < 100; i++) engine.setTarget({...target});
    assert.equal(changes(engine._context), initial);
    const activeMode = engine.getStatus().activeMode;
    engine.setTarget(musicParameters({sadness: 1}));
    assert.equal(engine.getStatus().parameters.mode, 'minor');
    assert.equal(engine.getStatus().activeMode, activeMode, 'harmony remains latched until next bar');
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('start during fade-out wins over stale pause and keeps one scheduler', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); const pause = engine.pause(); await engine.start(); await pause;
    assert.equal(engine.getStatus().playing, true); assert.equal(engine._context.state, 'running');
    assert.ok(engine._timer);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('a pause issued during resume wins over a stale start', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    const start = engine.start(); const pause = engine.pause(); await Promise.all([start, pause]);
    assert.equal(engine.getStatus().playing, false); assert.equal(engine._context.state, 'suspended'); assert.equal(engine._timer, null);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('a late background scheduler skips elapsed bars without firing old events', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    engine.setTarget(musicParameters({anger: 1})); await engine.start();
    const context = engine._context; const oldCount = context.nodes.length;
    context.currentTime = 600; engine._tick();
    const started = context.nodes.slice(oldCount).filter(node => Number.isFinite(node.started));
    assert.ok(started.length <= 64); assert.ok(started.every(node => node.started >= context.currentTime + .005));
    assert.ok(engine.getStatus().bar > 100);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('dispose during pause cancels its pending suspend and disconnects all nodes', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); const pause = engine.pause(); await engine.dispose(); await pause;
    assert.equal(engine.getStatus().contextState, 'closed'); assert.equal(engine.getStatus().activeVoices, 0);
    assert.ok(engine._context.nodes.every(node => node.disconnected));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});


test('six-section orchestra reports all layer levels and does not autoplay on an emotion update', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    const target = musicParameters({happiness: 1});
    engine.setTarget(target);
    assert.equal(engine._context, null);
    assert.deepEqual(Object.keys(engine.getStatus().levels), MUSIC_LAYERS);
    assert.equal(engine.getStatus().parameters.dynamics, target.dynamics);
    await engine.start();
    engine._context.currentTime = .1; engine._tick();
    assert.ok(engine.getStatus().activeVoices > 0);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('polyphony is bounded and emergency stop releases all oscillators and their modulation routes', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start();
    engine._graph.stopVoices(0);
    const target = musicParameters({anger: 1});
    const event = {layer: 'strings', midi: 60, duration: 2, velocity: .12, pan: .2};
    for (let note = 0; note < 64; note++) assert.equal(engine._graph.note(event, 10, target), true);
    assert.equal(engine._graph.note(event, 10, target), false);
    assert.equal(engine.getStatus().activeVoices, 64);
    const voices = [...engine._graph.voices];
    assert.ok(voices.every(voice => voice.sources.length <= 3));
    engine._graph.stopVoices(1);
    assert.equal(engine.getStatus().activeVoices, 0);
    assert.ok(voices.every(voice => [...voice.sources, ...voice.parts].every(node => node.disconnected)));
    assert.ok(voices.every(voice => voice.sources.every(source => source.stopped === 1)));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('all orchestral instruments finish and release their nodes without waiting for pause', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); engine._graph.stopVoices(0);
    const target = musicParameters({surprise: 1});
    for (const layer of MUSIC_LAYERS) {
      for (const kind of layer === 'percussion' ? ['timpani', 'taiko', 'cymbal'] : ['legato']) {
        assert.equal(engine._graph.note({layer, kind, midi: 60, duration: 2, velocity: .12}, 10, target), true);
      }
    }
    const voices = [...engine._graph.voices];
    assert.equal(voices.length, 8);
    for (const voice of voices) for (const source of voice.sources) source.onended();
    assert.equal(engine.getStatus().activeVoices, 0);
    assert.ok(voices.every(voice => [...voice.sources, ...voice.parts].every(node => node.disconnected)));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('pitched timpani fold octaves while preserving the chord root', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); engine._graph.stopVoices(0);
    engine._graph.note({layer: 'percussion', kind: 'timpani', midi: 48, duration: 1, velocity: .2}, 10, musicParameters({happiness: 1}));
    const voice = [...engine._graph.voices][0];
    const expectedC2 = 440 * 2 ** ((36 - 69) / 12);
    assert.ok(Math.abs(voice.sources[0].frequency.value - expectedC2) < .00001);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('strings and brass play real buffers with bounded pitch and sustain loops', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); engine._graph.stopVoices(0);
    for (const [layer, instrument, midi] of [['strings', 'violin', 64], ['brass', 'horn', 58]]) {
      assert.equal(engine._graph.note({layer, instrument, midi, duration: 12, velocity: .1}, 10, musicParameters({neutral: 1})), true);
      const voice = [...engine._graph.voices].at(-1);
      assert.equal(voice.sampled, true); assert.equal(voice.instrument, instrument);
      assert.equal(voice.sources.length, 1); assert.ok(voice.sources[0].buffer);
      assert.equal(voice.sources[0].loop, true);
      assert.equal(voice.sources[0].loopStart, .5); assert.equal(voice.sources[0].loopEnd, 3);
      assert.ok(voice.sources[0].playbackRate.value >= 2 ** (-3 / 12) && voice.sources[0].playbackRate.value <= 2 ** (3 / 12));
      assert.equal(voice.modulation.length, 0, 'recorded vibrato is preserved without artificial LFO');
    }
    assert.equal(engine.getStatus().sampleVoices, 2);
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('fragments scan recordings and reverse swells reuse an actually reversed sustain buffer', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); engine._graph.stopVoices(0);
    const target = musicParameters({fear: 1});
    for (const kind of ['grain', 'reverse', 'reverse']) {
      assert.equal(engine._graph.note({layer: 'melody', kind, instrument: 'violin', midi: 74, duration: kind === 'grain' ? .7 : 5, velocity: .1, scan: .8}, 10, target), true);
    }
    const [grain, reverse, repeated] = [...engine._graph.voices];
    assert.equal(engine.getStatus().textureVoices, 3);
    assert.equal(engine.getStatus().grainVoices, 1); assert.equal(engine.getStatus().reverseVoices, 2);
    const recording = grain.sources[0].buffer, backwards = reverse.sources[0].buffer;
    assert.ok(grain.sources[0].offset >= .5 && grain.sources[0].offset < 3);
    assert.notEqual(backwards, recording);
    assert.equal(backwards, repeated.sources[0].buffer, 'the same recording is reversed only once');
    assert.equal(backwards.length, 250);
    for (let channel = 0; channel < 2; channel++) {
      const original = recording.getChannelData(channel), reversed = backwards.getChannelData(channel);
      assert.equal(reversed[0], original[299]); assert.equal(reversed[249], original[50]);
    }
    assert.equal(reverse.sources[0].loopStart, 0); assert.equal(reverse.sources[0].loopEnd, 2.5);
    for (const voice of [grain, reverse, repeated]) for (const source of voice.sources) source.onended();
    assert.equal(engine.getStatus().textureVoices, 0);
    assert.ok([grain, reverse, repeated].every(voice => [...voice.sources, ...voice.parts].every(node => node.disconnected)));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('new textures share the voice limit and never fall back to a synthetic substitute for missing recordings', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start(); engine._graph.stopVoices(0);
    const target = musicParameters({surprise: 1});
    assert.equal(engine._graph.note({layer: 'melody', kind: 'grain', instrument: 'missing', midi: 74, duration: .7, velocity: .1}, 10, target), false);
    for (let index = 0; index < 64; index++) {
      const kind = ['grain', 'reverse', 'spark'][index % 3];
      assert.equal(engine._graph.note({layer: 'melody', kind, midi: 74, duration: 3, velocity: .1, scan: .3}, 10, target), true);
    }
    assert.equal(engine._graph.note({layer: 'melody', kind: 'spark', midi: 74, duration: 3, velocity: .1}, 10, target), false);
    assert.equal(engine.getStatus().activeVoices, 64);
    const voices = [...engine._graph.voices]; engine._graph.stopVoices(1);
    assert.equal(engine.getStatus().activeVoices, 0);
    assert.ok(voices.every(voice => [...voice.sources, ...voice.parts].every(node => node.disconnected)));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('resuming discards suspended delay and convolution tails while retaining decoded recordings', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  const engine = new EmotionMusicEngine();
  try {
    await engine.start();
    const graph = engine._graph, bank = engine._samples, oldNodes = [...engine._context.nodes];
    await engine.pause(); await engine.start();
    assert.notEqual(engine._graph, graph);
    assert.equal(engine._samples, bank, 'resume reuses the decoded sample bank');
    assert.ok(oldNodes.every(node => node.disconnected), 'old wet and dry paths are disconnected together');
    assert.equal(engine.getStatus().playing, true);
    engine.setVolume(0); assert.equal(engine._graph.master.gain.value, 0);
    await engine.dispose(); assert.ok(engine._context.nodes.every(node => node.disconnected));
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('resume occurs before sample loading, and pause during loading never starts playback later', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  let release, loads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new EmotionMusicEngine({sampleLoader: async (context, options) => {
    loads++; assert.equal(context.state, 'running');
    const bank = await loadOrchestraSamples(context, options); await gate; return bank;
  }});
  try {
    const start = engine.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(engine.getStatus().sampleStatus, 'loading'); assert.equal(engine.getStatus().playing, false);
    assert.equal(engine._timer, null);
    await engine.pause(); release(); await start;
    assert.equal(engine.getStatus().playing, false); assert.equal(engine.getStatus().contextState, 'suspended');
    assert.equal(engine.getStatus().activeVoices, 0); assert.equal(engine._timer, null);
    await engine.start(); assert.equal(loads, 1); assert.equal(engine.getStatus().playing, true);
  } finally { release(); await engine.dispose(); globalThis.AudioContext = previous; }
});

test('a failed bank load is reported, leaves no synthesized substitute, and can be explicitly retried', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  let loads = 0;
  const engine = new EmotionMusicEngine({sampleLoader: async (context, options) => {
    if (++loads === 1) throw new Error('Fixture sample unavailable');
    return loadOrchestraSamples(context, options);
  }});
  try {
    await assert.rejects(engine.start(), /unavailable/);
    assert.equal(engine.getStatus().sampleStatus, 'error'); assert.match(engine.getStatus().sampleError, /unavailable/);
    assert.equal(engine.getStatus().playing, false); assert.equal(engine.getStatus().activeVoices, 0);
    assert.equal(engine.getStatus().contextState, 'suspended'); assert.equal(engine._timer, null);
    await engine.start(); assert.equal(engine.getStatus().sampleStatus, 'ready'); assert.equal(engine.getStatus().playing, true);
    assert.equal(engine.getStatus().sampleError, '');
  } finally { await engine.dispose(); globalThis.AudioContext = previous; }
});

test('dispose during sample loading cancels playback without reconnecting a finished bank', async () => {
  const previous = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new EmotionMusicEngine({sampleLoader: async (context, options) => {
    const bank = await loadOrchestraSamples(context, options); await gate; return bank;
  }});
  try {
    const start = engine.start(); await new Promise(resolve => setImmediate(resolve));
    await engine.dispose(); release(); await start;
    assert.equal(engine.getStatus().contextState, 'closed'); assert.equal(engine.getStatus().playing, false);
    assert.equal(engine.getStatus().sampleCount, 0); assert.equal(engine.getStatus().activeVoices, 0);
    assert.equal(engine._timer, null); assert.ok(engine._context.nodes.every(node => node.disconnected));
  } finally { release(); await engine.dispose(); globalThis.AudioContext = previous; }
});
