import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveFluidState} from '../static/scent-fluid.mjs';
import {CHANNELS, PHASE_DURATIONS, normalizeRecipe, recipeForScores} from '../static/scent-math.mjs';
import {ScentSimulator} from '../static/scent-engine.mjs';

const happy = recipeForScores({happiness: 1});
const fear = recipeForScores({fear: 1});
const scalarKeys = ['fill', 'blend', 'inflow', 'front', 'release', 'purge'];
const snapshot = (phase, progress, extra = {}) => ({enabled: true, phase, progress,
  activeRecipe: happy, outputs: phase === 'releasing' ? happy.percentages : {},
  purge: phase === 'purging' ? 1 : 0, ...extra});
const fluid = (phase, progress, extra) => deriveFluidState(snapshot(phase, progress, extra));
const emptyMotion = state => { for (const key of scalarKeys) assert.equal(state[key], 0, `${key} should be zero`); };
const finiteMotion = state => {
  for (const key of scalarKeys) assert.ok(Number.isFinite(state[key]) && state[key] >= 0 && state[key] <= 1, `${key} outside [0,1]`);
  assert.match(state.color, /^#[0-9a-f]{6}$/);
  for (const {key, color} of CHANNELS) {
    assert.equal(state.ingredients[key].color, color);
    assert.ok(Number.isFinite(state.ingredients[key].weight));
    assert.ok(state.ingredients[key].weight >= 0 && state.ingredients[key].weight <= 1);
  }
};

test('liquid follows the current batch and ignores target and preparation recipes', () => {
  const first = fluid('mixing', .4, {targetRecipe: happy, smoothedRecipe: happy, recipe: happy});
  const changed = fluid('mixing', .4, {targetRecipe: fear, smoothedRecipe: fear, recipe: fear});
  assert.deepEqual(changed, first);
  const nextBatch = fluid('mixing', .4, {activeRecipe: fear});
  assert.notEqual(nextBatch.color, first.color);
  assert.notEqual(nextBatch.ingredients.bergamot.weight, first.ingredients.bergamot.weight);
  for (const phase of ['mixing', 'releasing']) {
    const noBatch = fluid(phase, .5, {activeRecipe: null, targetRecipe: happy, smoothedRecipe: happy, recipe: happy});
    emptyMotion(noBatch);
    assert.ok(Object.values(noBatch.ingredients).every(item => item.weight === 0));
  }
});

test('no data, invalid recipes or unknown-only outputs never create scent flow', () => {
  for (const source of [null, undefined, {}, {percentages: {}}, {percentages: {bergamot: NaN, pepper: Infinity}}, {percentages: {bergamot: -1}}]) {
    for (const phase of ['mixing', 'releasing']) emptyMotion(fluid(phase, .5, {activeRecipe: source}));
  }
  for (const outputs of [null, {}, {bergamot: 0}, {bergamot: -1}, {bergamot: NaN}, {bergamot: Infinity}, {unknown: 100}]) {
    emptyMotion(fluid('releasing', .5, {outputs}));
  }
  const onlyPepper = {percentages: {pepper: 100}};
  emptyMotion(fluid('releasing', .5, {activeRecipe: onlyPepper, outputs: {bergamot: 100}}));
});

test('manual recipes can flow without inventing emotional provenance', () => {
  const manual = normalizeRecipe({percentages: {bergamot: 60, pepper: 40}});
  assert.equal(manual.emotionWeights, null);
  const state = fluid('releasing', .5, {activeRecipe: manual, outputs: manual.percentages});
  assert.equal(state.stage, 'releasing');
  assert.ok(state.release > 0);
  assert.ok(Math.abs(state.ingredients.bergamot.weight - .6) < 1e-10);
  assert.ok(Math.abs(state.ingredients.pepper.weight - .4) < 1e-10);
  assert.ok(Object.values(state.ingredients).every(item => !Object.hasOwn(item, 'emotion')));
});

test('colored streams travel through pipes before slowly filling the chamber', () => {
  const beginning = fluid('mixing', 0);
  emptyMotion(beginning);
  const travelling = fluid('mixing', .1);
  assert.equal(travelling.stage, 'dosing');
  assert.ok(travelling.front > 0 && travelling.front < 1);
  assert.ok(travelling.inflow > 0);
  assert.equal(travelling.fill, 0);
  const arriving = fluid('mixing', .2);
  assert.equal(arriving.front, 1);
  assert.ok(arriving.fill > 0 && arriving.fill < .1);
  const gathering = fluid('mixing', .4);
  assert.ok(gathering.fill > arriving.fill && gathering.fill < .72);
  assert.ok(gathering.inflow > 0);
  assert.equal(gathering.blend, 0);
  for (const state of [beginning, travelling, arriving, gathering]) {
    assert.equal(state.release, 0);
    assert.equal(state.purge, 0);
  }
});

test('dosing retains separate colors, then closes its inlets for a slow blend', () => {
  const lastDosing = fluid('mixing', .59);
  const blending = fluid('mixing', .6);
  const middleBlend = fluid('mixing', .8);
  const ready = fluid('mixing', 1);
  assert.equal(lastDosing.stage, 'dosing');
  assert.ok(lastDosing.blend < .05);
  assert.equal(blending.stage, 'blending');
  assert.equal(blending.inflow, 0);
  assert.equal(blending.fill, .72);
  assert.ok(middleBlend.blend > blending.blend && middleBlend.blend < 1);
  assert.equal(middleBlend.fill, blending.fill);
  assert.equal(ready.blend, 1);
  assert.equal(ready.release, 0);
  assert.equal(ready.inflow, 0);
});

test('fill and visible mixture match at dosing, release, purge and wait boundaries', () => {
  const epsilon = 1e-7;
  const pairs = [
    [fluid('mixing', .6 - epsilon), fluid('mixing', .6)],
    [fluid('mixing', 1), fluid('releasing', 0)],
    [fluid('releasing', 1), fluid('purging', 0)],
    [fluid('purging', 1), fluid('waiting', 0)],
    [fluid('waiting', 1), fluid('mixing', 0)],
  ];
  for (const [before, after] of pairs) {
    assert.ok(Math.abs(before.fill - after.fill) < 1e-5);
    assert.ok(Math.abs(before.blend - after.blend) < 1e-5);
    assert.ok(Math.abs(before.release - after.release) < 1e-5);
  }
});

test('release empties the chamber monotonically with an eased outlet envelope', () => {
  let previous = .72;
  for (let step = 0; step <= 100; step++) {
    const state = fluid('releasing', step / 100);
    assert.equal(state.stage, 'releasing');
    assert.ok(state.fill <= previous + 1e-10);
    previous = state.fill;
    if (state.fill > 0) assert.equal(state.blend, 1, 'the released mixture must never separate again');
    assert.equal(state.inflow, 0);
    assert.equal(state.front, 0);
    assert.equal(state.purge, 0);
  }
  assert.equal(fluid('releasing', 0).fill, .72);
  assert.equal(fluid('releasing', 1).fill, 0);
  assert.equal(fluid('releasing', 0).release, 0);
  assert.equal(fluid('releasing', 1).release, 0);
  assert.ok(fluid('releasing', .03).release < fluid('releasing', .3).release);
  assert.ok(fluid('releasing', .98).release < fluid('releasing', .7).release);
  assert.ok(fluid('releasing', .5, {outputs: {bergamot: 16}}).release < fluid('releasing', .5).release);
});

test('only purge phase with its explicit air gate can render clear air', () => {
  const purge = fluid('purging', .5);
  assert.equal(purge.stage, 'purging');
  assert.ok(purge.purge > 0);
  for (const key of scalarKeys.filter(key => key !== 'purge')) assert.equal(purge[key], 0);
  assert.ok(fluid('purging', .5, {activeRecipe: null}).purge > 0);
  for (const gate of [0, -1, NaN, Infinity, null]) emptyMotion(fluid('purging', .5, {purge: gate}));
  assert.equal(fluid('purging', 0).purge, 0);
  assert.equal(fluid('purging', 1).purge, 0);
  for (const phase of ['mixing', 'releasing', 'stopped', 'idle', 'waiting']) assert.equal(fluid(phase, .5, {purge: 1}).purge, 0);
});

test('stopped, disabled, idle and waiting snapshots have no flow even with stale outputs', () => {
  for (const phase of ['stopped', 'idle', 'waiting', 'unknown']) {
    const state = fluid(phase, .5, {outputs: happy.percentages, purge: 1});
    assert.equal(state.stage, 'idle');
    emptyMotion(state);
  }
  for (const enabled of [false, undefined, null, 'true']) {
    for (const phase of ['mixing', 'releasing', 'purging']) emptyMotion(fluid(phase, .5, {enabled}));
  }
});

test('mixture color and ingredient weights are deterministic and retain the authored palette', () => {
  for (const {key, color} of CHANNELS) {
    const state = fluid('mixing', .5, {activeRecipe: {percentages: {[key]: 100}}});
    assert.equal(state.color, color);
    assert.equal(state.ingredients[key].weight, 1);
  }
  const a = fluid('mixing', .5, {activeRecipe: {percentages: {bergamot: 2, lavender: 1}}});
  const b = fluid('mixing', .5, {activeRecipe: {percentages: {bergamot: 200, lavender: 100}}});
  assert.deepEqual(a, b);
  assert.equal(new Set(['happiness', 'sadness', 'anger', 'fear'].map(emotion =>
    fluid('mixing', .5, {activeRecipe: recipeForScores({[emotion]: 1})}).color)).size, 4);
});

test('malformed and extreme numeric inputs always produce finite bounded outputs', () => {
  for (const progress of [-1e308, -Infinity, NaN, undefined, 0, .5, 1, Infinity, 1e308]) {
    for (const phase of ['mixing', 'releasing', 'purging', 'waiting']) {
      finiteMotion(fluid(phase, progress, {activeRecipe: {percentages: {bergamot: 1e308, pepper: 1e308}}, outputs: {bergamot: 1e308, pepper: 1e308}}));
    }
  }
  for (const input of [null, undefined, {}, 5, 'invalid']) {
    const state = deriveFluidState(input);
    finiteMotion(state);
    emptyMotion(state);
  }
});

test('derivation does not mutate snapshots or share ingredient objects across calls', () => {
  const input = snapshot('mixing', .5);
  const original = structuredClone(input);
  const first = deriveFluidState(input);
  first.ingredients.bergamot.weight = 999;
  first.ingredients.bergamot.color = '#000000';
  assert.deepEqual(input, original);
  assert.notEqual(deriveFluidState(input).ingredients.bergamot.weight, 999);
  assert.notEqual(deriveFluidState(input).ingredients.bergamot.color, '#000000');
});

test('a real simulator cycle flows internally, releases only when permitted and clears instantly', () => {
  let now = 0;
  const engine = new ScentSimulator({now: () => now});
  engine.setTarget(happy); engine.start();
  const endMix = PHASE_DURATIONS.mixing;
  const endRelease = endMix + PHASE_DURATIONS.releasing;
  const endPurge = endRelease + PHASE_DURATIONS.purging;
  let sawDosing = false, sawBlend = false, sawRelease = false, sawPurge = false;
  for (now = 100; now <= endPurge; now += 100) {
    const state = engine.tick();
    const liquid = deriveFluidState(state);
    finiteMotion(liquid);
    if (state.phase === 'mixing') {
      assert.ok(Object.values(state.outputs).every(value => value === 0));
      assert.equal(liquid.release, 0);
      sawDosing ||= liquid.inflow > 0;
      sawBlend ||= liquid.stage === 'blending' && liquid.blend > .5;
    } else if (state.phase === 'releasing') sawRelease ||= liquid.release > 0;
    else if (state.phase === 'purging') {sawPurge ||= liquid.purge > 0;assert.equal(liquid.release, 0);}
    else emptyMotion(liquid);
  }
  assert.ok(sawDosing && sawBlend && sawRelease && sawPurge);
  emptyMotion(deriveFluidState(engine.stop('cleared', now)));
});
