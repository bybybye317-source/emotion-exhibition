import test from 'node:test';
import assert from 'node:assert/strict';
import {stereoAmplitude, SpectrumFeatures, createVisualFrame, clearVisualFrame} from '../static/music-analysis.mjs';

test('stereo RMS preserves opposite phase and one-channel energy', () => {
  const left = Float32Array.from([.5, -.5, .5, -.5]);
  const right = Float32Array.from([-.5, .5, -.5, .5]);
  const out = {rms: 0, peak: 0};
  assert.equal(stereoAmplitude(left, right, out), out);
  assert.equal(out.rms, .5); assert.equal(out.peak, .5);
  stereoAmplitude(left, new Float32Array(4), out);
  assert.ok(Math.abs(out.rms - .5 / Math.sqrt(2)) < 1e-12);
});

test('sample measurements reject non-finite data and remain bounded', () => {
  const out = stereoAmplitude(Float32Array.from([NaN, Infinity, -Infinity, 8]), Float32Array.from([0, 0, 0, -9]));
  assert.equal(out.rms, .5); assert.equal(out.peak, 1);
  assert.deepEqual(stereoAmplitude(new Float32Array(0), new Float32Array(0)), {rms: 0, peak: 0});
});

test('FFT features isolate low, middle and high frequencies and use measured amplitude', () => {
  for (const [key, bin] of [['bass', 4], ['mid', 32], ['treble', 256]]) {
    const spectrum = new SpectrumFeatures(48000, 2048);
    const left = new Float32Array(1024).fill(-Infinity), right = new Float32Array(1024).fill(-Infinity);
    left[bin] = right[bin] = -20;
    const frame = createVisualFrame();
    assert.equal(spectrum.read(left, right, frame), frame);
    assert.ok(Math.abs(frame[key] - .25) < 1e-12);
    for (const other of ['bass', 'mid', 'treble'].filter(name => name !== key)) assert.equal(frame[other], 0);
    assert.equal(frame.flux, 0, 'first observation does not invent a transient');
    left[bin] = right[bin] = -40;
    spectrum.read(left, right, frame);
    assert.ok(Math.abs(frame[key] - .025) < 1e-12, '20 dB quieter input produces ten times less band strength');
    assert.equal(frame.flux, 0, 'a fading spectrum is not an onset');
  }
});

test('positive spectral flux follows rising frequency energy and reset clears history', () => {
  const spectrum = new SpectrumFeatures(48000, 2048), frame = createVisualFrame();
  const left = new Float32Array(1024).fill(-Infinity), right = new Float32Array(1024).fill(-Infinity);
  spectrum.read(left, right, frame);
  left[32] = right[32] = -20;
  spectrum.read(left, right, frame); assert.ok(Math.abs(frame.flux - .4) < 1e-8);
  spectrum.read(left, right, frame); assert.equal(frame.flux, 0);
  spectrum.reset(); spectrum.read(left, right, frame); assert.equal(frame.flux, 0);
  left.fill(NaN); right.fill(Infinity); spectrum.read(left, right, frame);
  for (const key of ['bass', 'mid', 'treble', 'flux']) assert.equal(frame[key], 0);
});

test('DC and ultrasonic bins do not masquerade as musical band activity', () => {
  const spectrum = new SpectrumFeatures(48000, 2048), frame = createVisualFrame();
  const data = new Float32Array(1024).fill(-Infinity); data[0] = 0; data[800] = 0;
  spectrum.read(data, data, frame);
  for (const key of ['bass', 'mid', 'treble', 'flux']) assert.equal(frame[key], 0);
  data.fill(0); spectrum.read(data, data, frame);
  for (const key of ['bass', 'mid', 'treble', 'flux']) assert.ok(Number.isFinite(frame[key]) && frame[key] <= 1 && frame[key] >= 0);
});

test('clearing a reused frame zeros every signal and layer without changing its identity', () => {
  const frame = createVisualFrame(); Object.assign(frame, {playing: true, rms: .4, peak: .6, bass: .3, mid: .2, treble: .1, flux: .9});
  for (const key of Object.keys(frame.layers)) frame.layers[key] = .4;
  assert.equal(clearVisualFrame(frame, true), frame); assert.equal(frame.playing, true);
  for (const [key, value] of Object.entries(frame)) if (key !== 'playing' && key !== 'layers') assert.equal(value, 0);
  assert.ok(Object.values(frame.layers).every(value => value === 0));
});
