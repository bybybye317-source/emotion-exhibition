import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MUSIC_BPM, MUSIC_LAYERS, EMOTIONS, BAR_SECONDS, musicParameters, sanitizeParameters, groupDiversity, planBar, eventsInWindow} from '../static/music-math.mjs';
import {selectOrchestraSample, validateSampleManifest, MAX_SAMPLE_TRANSPOSE} from '../static/music-samples.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const numericKeys = ['brightness', 'energy', 'tension', 'dynamics', 'orchestration', 'texture', 'drift', 'space', 'diversity', ...MUSIC_LAYERS];
const score = (p, bars = 64) => Array.from({length: bars}, (_, bar) => planBar(bar, p));
const layer = (bars, name) => bars.flat().filter(e => e.layer === name);

for (const emotion of EMOTIONS) test(`${emotion}: six bounded layers and long playable sample strands`, () => {
  const p = musicParameters({[emotion]: 1}, {diversity: 1});
  for (const key of numericKeys) assert.ok(Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= 1, key);
  assert.equal(p.pad, p.strings);
  for (const events of score(p)) {
    assert.ok(events.length <= 20);
    assert.ok(events.every(e => MUSIC_LAYERS.includes(e.layer)));
    assert.ok(events.every(e => e.offset >= 0 && e.offset < BAR_SECONDS && e.duration > 0 && e.duration <= 12));
    assert.ok(events.every(e => e.velocity > 0 && e.velocity < .25 && Math.abs(e.pan) <= 1));
    assert.ok(events.filter(e => Number.isFinite(e.midi)).every(e => Number.isInteger(e.midi) && e.midi >= 38 && e.midi <= 86));
    assert.ok(events.filter(e => e.swell !== undefined).every(e => e.swell >= 0 && e.swell <= 1));
    assert.ok(events.filter(e => e.layer === 'strings').every(e => e.duration >= 10 && e.kind === 'legato'));
    assert.ok(events.filter(e => e.layer === 'brass').every(e => e.duration >= 7 && e.kind === 'legato'));
  }
});

test('weighted observations preserve all eight artistic features and ignore score scale', () => {
  const happy = musicParameters({happiness: 1}), sad = musicParameters({sadness: 1});
  const mixed = musicParameters({happiness: 3, sadness: 1});
  for (const key of ['brightness', 'energy', 'tension', 'dynamics', 'orchestration', 'texture', 'drift', 'space']) close(mixed[key], happy[key] * .75 + sad[key] * .25);
  assert.deepEqual(mixed, musicParameters({happiness: 300, sadness: 100}));
  close(musicParameters({happiness: Number.MAX_VALUE, sadness: Number.MAX_VALUE}).brightness, (happy.brightness + sad.brightness) / 2);
});

test('missing observations leave only restrained strings and synth without a false emotion', () => {
  for (const scores of [undefined, null, {}, {happiness: NaN, fear: Infinity, sadness: -2}, {happiness: '1'}]) {
    const p = musicParameters(scores);
    assert.equal(p.idle, true); assert.equal(p.dominant, null);
    for (const name of ['brass', 'bass', 'melody', 'percussion']) assert.equal(p[name], 0);
    assert.equal(planBar(0, p).length, 4);
    assert.ok(score(p).flat().every(e => ['strings', 'synth'].includes(e.layer)));
  }
  assert.equal(musicParameters({anger: 1}, {idle: true}).dominant, null);
});

test('every mood holds the same D bass pedal instead of cycling chord roots', () => {
  assert.equal(MUSIC_BPM, 84); close(BAR_SECONDS, 4 * 60 / MUSIC_BPM);
  const happy = musicParameters({happiness: 1}), sad = musicParameters({sadness: 1}), fear = musicParameters({fear: 1});
  assert.equal(happy.mode, 'major'); assert.equal(sad.mode, 'minor'); assert.equal(fear.mode, 'suspended');
  assert.ok(happy.brightness > sad.brightness && happy.energy > sad.energy);
  assert.ok(fear.tension > happy.tension && fear.synth > happy.synth);
  for (const emotion of EMOTIONS) {
    const bars = score(musicParameters({[emotion]: 1}), 96);
    assert.deepEqual(new Set(layer(bars, 'bass').map(e => e.midi)), new Set([38]));
    assert.ok(bars.filter(events => events.some(e => e.layer === 'bass')).length <= 24);
    assert.ok(layer(bars, 'bass').every(e => e.duration > 4 * BAR_SECONDS));
    assert.deepEqual(new Set(layer(bars, 'strings').filter(e => e.instrument === 'cello').map(e => e.midi)), new Set([50, 57]));
  }
});

test('upper colour moves independently rather than repeating four or eight bar chord blocks', () => {
  const p = musicParameters({happiness: 1});
  const bars = score(p, 96);
  const signature = events => events.filter(e => e.layer === 'strings').map(e => `${e.midi}:${e.offset.toFixed(3)}`);
  assert.notDeepEqual(signature(bars[4]), signature(bars[8]));
  assert.notDeepEqual(signature(bars[8]), signature(bars[16]));
  assert.notDeepEqual(planBar(0, p), planBar(8, p));
  // These are long asynchronous entrances, not six chord tones retriggered every bar.
  assert.ok(bars.slice(1).filter(events => events.filter(e => e.layer === 'strings').length <= 2).length > 50);
  assert.ok(layer(bars, 'strings').every(e => e.offset > 0 && e.duration > 3 * BAR_SECONDS));
  const violinVoices = new Map();
  for (let bar = 0; bar < bars.length; bar++) {
    for (const event of bars[bar].filter(e => e.layer === 'strings' && e.instrument === 'violin')) {
      if (!violinVoices.has(event.pan)) violinVoices.set(event.pan, []);
      violinVoices.get(event.pan).push({bar, midi: event.midi});
    }
  }
  for (const voice of violinVoices.values()) {
    assert.ok(voice.some((note, i) => i && note.midi === voice[i - 1].midi));
    assert.ok(voice.some((note, i) => i && note.midi !== voice[i - 1].midi));
  }
});

test('sadness remains broad and sustained while melody and brass make space', () => {
  const sad = musicParameters({sadness: 1});
  const bars = score(sad);
  assert.ok(sad.orchestration > .8 && sad.strings > .85);
  assert.equal(layer(bars, 'percussion').length, 0);
  const longMelody = layer(bars, 'melody').filter(e => e.kind === 'texture');
  assert.ok(longMelody.length < 16);
  assert.ok(layer(bars, 'brass').length < 14);
  assert.ok(bars.every(events => events.filter(e => e.layer === 'melody' && e.kind === 'texture').length <= 1));
  assert.ok(longMelody.every(e => e.duration > 8));
  const strings = layer(bars, 'strings');
  assert.ok(Math.max(...strings.map(e => e.midi)) - Math.min(...strings.map(e => e.midi)) >= 24);
});

test('space and drift do not collapse into volume or activity when moods change', () => {
  const sad = musicParameters({sadness: 1}), anger = musicParameters({anger: 1}), fear = musicParameters({fear: 1});
  assert.ok(sad.space > anger.space && sad.dynamics < anger.dynamics);
  assert.ok(fear.drift > anger.drift && fear.texture > anger.texture && fear.energy < anger.energy);
  const diverse = musicParameters({sadness: 1}, {diversity: 1});
  assert.ok(diverse.texture > sad.texture && diverse.drift > sad.drift);
  assert.equal(diverse.space, sad.space);
  assert.equal(diverse.dynamics, sad.dynamics);
});

test('cosmic fragments vary in timing, scan region and direction without adding chord roots', () => {
  const p = musicParameters({fear: 1}, {diversity: 1});
  const bars = score(p, 128);
  const micro = bars.flat().filter(e => ['grain', 'reverse', 'spark'].includes(e.kind));
  assert.deepEqual(bars, score(p, 128));
  assert.deepEqual(new Set(micro.map(e => e.kind)), new Set(['grain', 'reverse', 'spark']));
  assert.ok(micro.every(e => e.layer === 'melody' && e.scan >= 0 && e.scan <= 1));
  assert.ok(micro.filter(e => e.kind === 'grain').every(e => e.duration >= .35 && e.duration <= 1.4));
  assert.ok(micro.filter(e => e.kind === 'reverse').every(e => e.duration >= 3 && e.duration <= 7));
  assert.ok(micro.filter(e => e.kind === 'spark').every(e => e.duration >= 1 && e.duration <= 4));
  assert.ok(bars.every(events => events.filter(e => ['grain', 'reverse', 'spark'].includes(e.kind)).length <= 6));
  assert.ok(new Set(micro.map(e => e.scan.toFixed(3))).size > 100);
  const offGrid = micro.filter(e => Math.abs(e.offset / (BAR_SECONDS / 4) - Math.round(e.offset / (BAR_SECONDS / 4))) > .04);
  assert.ok(offGrid.length / micro.length > .85);
  assert.deepEqual(new Set(layer(bars, 'bass').map(e => e.midi)), new Set([38]));
});

test('density changes the fragment layer without rewriting the orchestral bed', () => {
  const p = musicParameters({neutral: 1});
  const isMicro = e => ['grain', 'reverse', 'spark'].includes(e.kind);
  const none = score({...p, texture: 0}), sparse = score({...p, texture: .1}), dense = score({...p, texture: 1});
  assert.equal(none.flat().filter(isMicro).length, 0);
  assert.ok(dense.flat().filter(e => e.kind === 'grain').length > sparse.flat().filter(e => e.kind === 'grain').length * 1.5);
  assert.deepEqual(dense.flat().filter(e => !isMicro(e)), none.flat());
});

test('every sample fragment and reverse swell has an actual shipped violin recording nearby', async () => {
  const manifestUrl = new URL('../static/audio/orchestra/manifest.json', import.meta.url);
  const manifest = validateSampleManifest(JSON.parse(await readFile(manifestUrl, 'utf8')), 'https://example.github.io/emotion-exhibition/static/audio/orchestra/manifest.json');
  const bank = {samples: manifest.entries};
  let checked = 0;
  for (const emotion of EMOTIONS) {
    const p = musicParameters({[emotion]: 1}, {diversity: 1});
    for (const event of score(p, 256).flat().filter(e => ['grain', 'reverse'].includes(e.kind))) {
      const sample = selectOrchestraSample(bank, {...event, layer: 'strings'}, p.dynamics);
      assert.ok(sample, `${emotion}: ${event.kind} MIDI ${event.midi} has no recording`);
      assert.equal(sample.instrument, 'violin');
      assert.ok(Math.abs(event.midi - sample.midi) <= MAX_SAMPLE_TRANSPOSE);
      checked++;
    }
  }
  assert.ok(checked > 3000);
});

test('anger increases sparse impacts and brass pressure without a busy drum or arpeggio pattern', () => {
  const anger = musicParameters({anger: 1}), fear = musicParameters({fear: 1}), sad = musicParameters({sadness: 1});
  const count = (p, name) => layer(score(p), name).length;
  assert.ok(count(anger, 'percussion') > count(fear, 'percussion'));
  assert.ok(count(fear, 'percussion') > count(sad, 'percussion'));
  assert.ok(count(anger, 'brass') > count(fear, 'brass'));
  assert.ok(anger.dynamics > fear.dynamics && anger.percussion > fear.percussion);
  const bars = score(anger);
  assert.ok(layer(bars, 'percussion').length < bars.length);
  assert.ok(bars.every(events => events.filter(e => e.layer === 'percussion').length <= 3));
  assert.deepEqual(new Set(layer(bars, 'percussion').map(e => e.kind)), new Set(['timpani', 'taiko', 'cymbal']));
  const pulses = layer(bars, 'synth').filter(e => e.kind === 'pulse');
  assert.ok(pulses.length > 0 && pulses.length < 25);
  assert.deepEqual(new Set(pulses.map(e => e.midi)), new Set([62]));
  assert.ok(pulses.every(e => Math.abs(e.offset / (BAR_SECONDS / 4) - Math.round(e.offset / (BAR_SECONDS / 4))) > .01));
});

test('playing strength changes note velocities while sustained articulation remains natural', () => {
  const base = musicParameters({happiness: 1});
  const gentle = score({...base, dynamics: .2});
  const strong = score({...base, dynamics: .95});
  for (const name of MUSIC_LAYERS) {
    const a = layer(gentle, name), b = layer(strong, name);
    assert.ok(a.length && b.length, name);
    assert.equal(a.length, b.length, name);
    assert.ok(b.every((note, i) => note.velocity > a[i].velocity), name);
  }
  assert.ok(layer(strong, 'brass').every(e => e.kind === 'legato'));
});

test('all modes share one modal pitch collection while their upper colours differ', () => {
  const pitchClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
  const fields = [];
  for (const mode of ['major', 'minor', 'suspended']) {
    const p = {...musicParameters({surprise: 1}, {diversity: 1}), mode};
    const bars = score(p, 96);
    assert.deepEqual(bars, score(p, 96));
    assert.ok(bars.flat().filter(e => Number.isFinite(e.midi)).every(e => pitchClasses.has(e.midi % 12)));
    fields.push(layer(bars, 'strings').filter(e => e.instrument === 'violin').map(e => e.midi));
  }
  assert.notDeepEqual(fields[0], fields[1]); assert.notDeepEqual(fields[1], fields[2]);
});

test('all sample note ranges stay within the recorded instrument neighbourhoods', () => {
  const ranges = {violin: [57, 81], cello: [43, 62], horn: [46, 62], trombone: [41, 65]};
  for (const emotion of EMOTIONS) {
    for (const note of score(musicParameters({[emotion]: 1})).flat().filter(e => ['strings', 'brass'].includes(e.layer))) {
      assert.ok(ranges[note.instrument], note.instrument);
      const [min, max] = ranges[note.instrument];
      assert.ok(note.midi >= min && note.midi <= max, `${note.instrument} ${note.midi}`);
    }
  }
});

test('long overlapping notes remain below the voice budget even with per-bar emotion switches', () => {
  const boundaries = [];
  for (let bar = 0; bar < 192; bar++) {
    const p = musicParameters({[EMOTIONS[bar % EMOTIONS.length]]: 1}, {diversity: 1});
    for (const e of planBar(bar, p)) {
      const start = bar * BAR_SECONDS + e.offset;
      boundaries.push([start, 1], [start + e.duration, -1]);
    }
  }
  boundaries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0;
  for (const [, delta] of boundaries) { active += delta; peak = Math.max(peak, active); }
  assert.ok(peak <= 32, `peak ${peak} note voices exceeds the restrained score budget`);
  assert.equal(active, 0);
});

test('diversity distinguishes disagreement from uncertain individual scores and adds only a quiet colour strand', () => {
  close(groupDiversity([{scores: {happiness: .5, sadness: .5}}, {scores: {happiness: .5, sadness: .5}}]), 0);
  close(groupDiversity([{scores: {happiness: 1}}, {scores: {sadness: 1}}]), 1);
  close(groupDiversity([{scores: {happiness: 1}}]), 0);
  close(groupDiversity(null), 0);
  close(groupDiversity([{}, {}, {scores: {happiness: 1}}]), 0);
  const p = musicParameters({happiness: 1});
  const diverse = score({...p, diversity: 1}), same = score(p);
  assert.ok(layer(diverse, 'synth').length > layer(same, 'synth').length);
  assert.equal(layer(diverse, 'melody').length, layer(same, 'melody').length);
  assert.equal(layer(diverse, 'bass').length, layer(same, 'bass').length);
});

test('late scheduling drops past events instead of replaying a backlog', () => {
  const events = [{offset: 0}, {offset: 1}, {offset: 1.06}, {offset: 1.15}, {offset: 2}];
  assert.deepEqual(eventsInWindow(events, 50, 51), [{offset: 1.06}, {offset: 1.15}]);
  assert.deepEqual(eventsInWindow(events, 50, 300), []);
  assert.deepEqual(eventsInWindow(events, 50, 51, -1), []);
});

test('external controls sanitize non-finite and out-of-range input', () => {
  const p = sanitizeParameters({energy: Infinity, brightness: -1, tension: 7, strings: NaN, brass: 8, mode: 'invalid', texture: Infinity, drift: -3, space: 8});
  assert.equal(p.brightness, 0); assert.equal(p.tension, 1); assert.equal(p.brass, 1); assert.equal(p.mode, 'suspended');
  assert.ok(Object.values(p).every(value => typeof value !== 'number' || Number.isFinite(value)));
  assert.equal(p.texture, musicParameters(null).texture); assert.equal(p.drift, 0); assert.equal(p.space, 1);
  assert.doesNotThrow(() => planBar(-Infinity, null));
  assert.deepEqual(planBar(-3, p), planBar(0, p));
  assert.ok(planBar(Number.MAX_VALUE, p).every(e => Number.isFinite(e.offset) && Number.isFinite(e.velocity)));
});
