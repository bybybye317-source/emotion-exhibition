import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadOrchestraSamples, selectOrchestraSample, validateSampleManifest, MAX_SAMPLE_TRANSPOSE} from '../static/music-samples.mjs';
import {musicParameters, planBar} from '../static/music-math.mjs';

let fixtureId = 0;
function fixture() {
  const manifestUrl = `https://sample-fixtures.test/${fixtureId++}/manifest.json`;
  const sample = (instrument, midi, velocity) => ({url: `./${instrument}-${midi}-${velocity}.wav`, midi, velocity, loopStartSeconds: .5, loopEndSeconds: 2.5, gain: 1});
  const manifest = {version: 1, library: 'VSCO 2 CE', license: 'CC0-1.0', instruments: {
    violin: [sample('violin', 62, .35), sample('violin', 62, .8), sample('violin', 66, .35), sample('violin', 66, .8)],
    horn: [sample('horn', 57, .35), sample('horn', 57, .8)],
  }};
  let fetches = 0;
  const fetcher = async url => { fetches++; return {ok: true, json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(16)}; };
  const context = {decodes: 0, async decodeAudioData(bytes) { this.decodes++; assert.equal(bytes.byteLength, 16); structuredClone(bytes, {transfer: [bytes]}); return {duration: 3}; }};
  return {manifest, manifestUrl, fetcher, context, fetches: () => fetches};
}

test('recorded banks reuse requests and decodes within one context, but decode for each audio context', async () => {
  const f = fixture(), progress = [];
  const options = {manifestUrl: f.manifestUrl, fetcher: f.fetcher, onProgress: p => progress.push(p)};
  const [a, b] = await Promise.all([loadOrchestraSamples(f.context, options), loadOrchestraSamples(f.context, options)]);
  assert.equal(f.fetches(), 7); assert.equal(f.context.decodes, 6);
  assert.equal(a.samples[0].buffer, b.samples[0].buffer);
  assert.deepEqual(progress.at(-1), {loaded: 6, total: 6});
  const another = {decodes: 0, decodeAudioData: f.context.decodeAudioData};
  await loadOrchestraSamples(another, options);
  assert.equal(another.decodes, 6); assert.equal(f.fetches(), 7);
});

test('sample selection preserves pitch, real dynamic layer, and instrument identity', async () => {
  const f = fixture(); const bank = await loadOrchestraSamples(f.context, f);
  const soft = selectOrchestraSample(bank, {layer: 'strings', instrument: 'violin', midi: 64}, .3);
  const loud = selectOrchestraSample(bank, {layer: 'strings', instrument: 'violin', midi: 64}, .9);
  assert.equal(soft.velocity, .35); assert.equal(loud.velocity, .8);
  assert.ok(Math.abs(soft.playbackRate - 2 ** (2 / 12)) < 1e-10);
  assert.equal(soft.instrument, 'violin'); assert.equal(soft.loopStart, .5);
  assert.equal(selectOrchestraSample(bank, {layer: 'strings', instrument: 'cello', midi: 62}, .5), null);
  assert.equal(selectOrchestraSample(bank, {layer: 'brass', midi: 57 + MAX_SAMPLE_TRANSPOSE + 1}, .5), null);
});

test('manifest validates both families, MIDI roots, and sustain loops before audio is scheduled', () => {
  const f = fixture();
  assert.equal(validateSampleManifest(f.manifest, f.manifestUrl).entries.length, 6);
  assert.throws(() => validateSampleManifest({...f.manifest, instruments: {violin: f.manifest.instruments.violin}}, f.manifestUrl), /铜管/);
  const bad = structuredClone(f.manifest); bad.instruments.violin[0].loopEndSeconds = .4;
  assert.throws(() => validateSampleManifest(bad, f.manifestUrl), /延音循环/);
  bad.instruments.violin[0].midi = NaN;
  assert.throws(() => validateSampleManifest(bad, f.manifestUrl), /音高/);
});

test('404 fails without repeated traffic and a later explicit retry fetches again', async () => {
  const f = fixture(); let requests = 0;
  const fetcher = async (...args) => { requests++; return requests === 1 ? {ok: false, status: 404} : f.fetcher(...args); };
  await assert.rejects(loadOrchestraSamples(f.context, {...f, fetcher}), /404/);
  assert.equal(requests, 1);
  const bank = await loadOrchestraSamples(f.context, {...f, fetcher});
  assert.equal(bank.samples.length, 6); assert.equal(requests, 8);
});

test('hung local connections have a bounded timeout, one retry, and no cached rejection', async () => {
  const f = fixture(); let attempts = 0;
  await assert.rejects(loadOrchestraSamples(f.context, {...f, timeoutMs: 8, fetcher: () => { attempts++; return new Promise(() => {}); }}), /超时/);
  assert.equal(attempts, 2);
  assert.equal((await loadOrchestraSamples(f.context, f)).samples.length, 6);
});

test('a loop outside the decoded recording is rejected rather than substituting synthesis', async () => {
  const f = fixture();
  await assert.rejects(loadOrchestraSamples({decodeAudioData: async () => ({duration: 1})}, f), /录音长度/);
});

test('all scheduled string and brass notes fit the shipped recordings without wide transposition', async () => {
  const manifestUrl = new URL('../static/audio/orchestra/manifest.json', import.meta.url);
  const manifest = validateSampleManifest(JSON.parse(await readFile(manifestUrl, 'utf8')), 'https://example.github.io/emotion-exhibition/static/audio/orchestra/manifest.json');
  const bank = {samples: manifest.entries};
  let checked = 0;
  for (const emotion of ['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt']) {
    const parameters = musicParameters({[emotion]: 1});
    for (let bar = 0; bar < 256; bar++) {
      for (const event of planBar(bar, parameters)) {
        if (!['strings', 'brass'].includes(event.layer)) continue;
        const sample = selectOrchestraSample(bank, event, parameters.dynamics);
        assert.ok(sample, `${emotion}, bar ${bar}, ${event.instrument || event.layer}, MIDI ${event.midi} lacks a recording within ${MAX_SAMPLE_TRANSPOSE} semitones`);
        assert.ok(Math.abs(sample.midi - event.midi) <= MAX_SAMPLE_TRANSPOSE);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});

test('shipped orchestra URLs stay under a GitHub Pages project subpath', async()=>{
  const {readFile}=await import('node:fs/promises');
  const base='https://example.github.io/emotion-exhibition/static/audio/orchestra/manifest.json';
  const manifest=JSON.parse(await readFile(new URL('../static/audio/orchestra/manifest.json',import.meta.url),'utf8'));
  for(const family of Object.values(manifest.instruments))for(const sample of family){assert.ok(!sample.url.startsWith('/'));assert.ok(new URL(sample.url,base).pathname.startsWith('/emotion-exhibition/static/audio/orchestra/'));}
});
