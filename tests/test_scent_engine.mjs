import test from 'node:test';
import assert from 'node:assert/strict';
import {ScentSimulator, SimulationDriver} from '../static/scent-engine.mjs';
import {CHANNELS, EMOTIONS, PHASE_DURATIONS, normalizeRecipe, recipeForScores} from '../static/scent-math.mjs';

const happy = () => recipeForScores({happiness: 1});
const sad = () => recipeForScores({sadness: 1});
const D = PHASE_DURATIONS;
const RELEASE_AT = D.mixing;
const PURGE_AT = RELEASE_AT + D.releasing;
const WAIT_AT = PURGE_AT + D.purging;
const CYCLE = WAIT_AT + D.waiting;
const INTO_RELEASE = RELEASE_AT + 1000;
const INTO_PURGE = PURGE_AT + 1000;
const zeros = Object.fromEntries(CHANNELS.map(({key}) => [key, 0]));
function setup() {
  let now = 0;
  const driver = new SimulationDriver();
  const engine = new ScentSimulator({now: () => now, driver});
  function advance(to, interval = 100) {
    while (now < to) { now = Math.min(to, now + interval); engine.tick(); }
    return engine.snapshot();
  }
  return {engine, driver, advance, time: value => { now = value; }};
}

test('simulator remains stopped until explicitly started; start without data only arms idle', () => {
  const {engine, driver} = setup();
  assert.equal(engine.snapshot().enabled, false);
  assert.deepEqual(driver.outputs, zeros);
  assert.equal(engine.start().phase, 'idle');
  assert.equal(engine.snapshot().enabled, true);
  assert.equal(engine.snapshot().activeRecipe, null);
  assert.deepEqual(engine.snapshot().outputs, zeros);
  engine.setTarget(happy());
  assert.equal(engine.snapshot().phase, 'mixing');
  assert.equal(engine.snapshot().cycles, 1);
});

test('default 29-second cycle follows prepare/release/purge/wait with output only during release', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start();
  assert.equal(CYCLE, 29000);
  assert.deepEqual(advance(RELEASE_AT - 1).outputs, zeros);
  const release = advance(RELEASE_AT);
  assert.equal(release.phase, 'releasing');
  assert.equal(release.remaining, D.releasing / 1000);
  assert.deepEqual(release.outputs, happy().percentages);
  assert.deepEqual(driver.outputs, release.outputs);
  assert.equal(driver.purge, 0);
  const midway = advance(RELEASE_AT + D.releasing / 2);
  assert.equal(midway.progress, .5); assert.equal(midway.remaining, D.releasing / 2000);
  const purge = advance(PURGE_AT);
  assert.equal(purge.phase, 'purging'); assert.equal(purge.purge, 1);
  assert.deepEqual(purge.outputs, zeros); assert.deepEqual(driver.outputs, zeros);
  const wait = advance(WAIT_AT);
  assert.equal(wait.phase, 'waiting'); assert.equal(wait.purge, 0);
  assert.deepEqual(wait.outputs, zeros);
  const next = advance(CYCLE);
  assert.equal(next.phase, 'mixing'); assert.equal(next.cycles, 2);
  assert.deepEqual(next.outputs, zeros);
});

test('new emotion is smoothed and pending while active recipe stays latched through the whole cycle', () => {
  const {engine, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(INTO_RELEASE);
  engine.setTarget(sad());
  assert.equal(engine.snapshot().pending, true);
  const halfway = advance(INTO_RELEASE + 4000);
  assert.deepEqual(halfway.activeRecipe, happy());
  assert.equal(halfway.activeRecipe.emotionWeights.happiness, 1);
  assert.equal(halfway.activeRecipe.contributions.bergamot.sadness, 0);
  assert.equal(halfway.targetRecipe.emotionWeights.sadness, 1);
  assert.ok(halfway.smoothedRecipe.emotionWeights.happiness > 0);
  assert.ok(halfway.smoothedRecipe.emotionWeights.sadness > 0);
  assert.deepEqual(halfway.smoothedRecipe, recipeForScores(halfway.smoothedRecipe.emotionWeights));
  assert.deepEqual(halfway.outputs, happy().percentages);
  assert.ok(halfway.smoothedRecipe.percentages.bergamot < happy().percentages.bergamot);
  assert.ok(halfway.smoothedRecipe.percentages.bergamot > sad().percentages.bergamot);
  assert.deepEqual(advance(CYCLE - 1).activeRecipe, happy());
  const next = advance(CYCLE);
  assert.notDeepEqual(next.activeRecipe.percentages, happy().percentages);
  assert.ok(next.activeRecipe.percentages.bergamot < 15);
  assert.equal(Object.values(next.activeRecipe.percentages).reduce((a, b) => a + b), 100);
});

test('repeating targets does not restart cycles or slow exponential convergence', () => {
  const a = setup(); const b = setup();
  for (const run of [a, b]) { run.engine.setTarget(happy()); run.engine.start(); run.advance(1000); run.engine.setTarget(sad()); }
  for (let time = 1200; time <= 7000; time += 200) { a.advance(time); a.engine.setTarget(sad()); }
  b.advance(7000);
  assert.deepEqual(a.engine.snapshot().smoothedRecipe, b.engine.snapshot().smoothedRecipe);
  assert.equal(a.engine.snapshot().smoothedRecipe.percentages.bergamot, 15);
  assert.equal(a.engine.snapshot().phase, 'mixing');
  assert.equal(a.engine.snapshot().remaining, (D.mixing - 7000) / 1000);
  assert.equal(a.engine.snapshot().cycles, 1);
});

test('clearing valid input while releasing immediately zeroes output and forgets old active/pending data', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(INTO_RELEASE); engine.setTarget(sad());
  const cleared = engine.setTarget(null);
  assert.equal(cleared.phase, 'idle'); assert.equal(cleared.enabled, true);
  assert.equal(cleared.pending, false); assert.equal(cleared.activeRecipe, null);
  assert.equal(cleared.targetRecipe, null); assert.equal(cleared.smoothedRecipe, null);
  assert.deepEqual(cleared.outputs, zeros); assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
  advance(INTO_RELEASE + 1000); engine.setTarget(sad());
  assert.equal(engine.snapshot().phase, 'mixing');
  assert.deepEqual(engine.snapshot().activeRecipe, sad());
});

test('manual stop persists across new data and keeps the next target available for review', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(INTO_RELEASE); engine.stop();
  engine.setTarget(sad()); advance(CYCLE);
  const state = engine.snapshot();
  assert.equal(state.enabled, false); assert.equal(state.phase, 'stopped');
  assert.equal(state.activeRecipe, null); assert.deepEqual(state.targetRecipe, sad());
  assert.equal(state.cycles, 1); assert.deepEqual(state.outputs, zeros); assert.deepEqual(driver.outputs, zeros);
  engine.start(); assert.equal(engine.snapshot().phase, 'mixing'); assert.equal(engine.snapshot().cycles, 2);
});

test('hidden, disconnected and clear stop reasons immediately stop releasing or purging', () => {
  for (const reason of ['hidden', 'disconnected', 'cleared']) {
    for (const time of [INTO_RELEASE, INTO_PURGE]) {
      const {engine, driver, advance} = setup();
      engine.setTarget(happy()); engine.start(); advance(time);
      const state = engine.stop(reason);
      assert.equal(state.reason, reason); assert.equal(state.enabled, false);
      assert.equal(state.activeRecipe, null); assert.equal(state.pending, false);
      assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
    }
  }
});

test('timer stalls stop instead of catching up or replaying a missed release', () => {
  for (const startTime of [1000, INTO_RELEASE]) {
    const {engine, driver, advance, time} = setup();
    engine.setTarget(happy()); engine.start(); advance(startTime);
    time(startTime + 10000); const state = engine.tick();
    assert.equal(state.reason, 'heartbeat'); assert.equal(state.phase, 'stopped');
    assert.equal(state.enabled, false); assert.equal(state.activeRecipe, null);
    assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
    engine.setTarget(sad()); engine.tick(); assert.equal(engine.snapshot().phase, 'stopped');
  }
});

test('incoming data cannot conceal a scheduler stall and backwards clocks fail stopped', () => {
  const {engine, driver, advance, time} = setup();
  engine.setTarget(happy()); engine.start(); advance(INTO_RELEASE);
  time(INTO_RELEASE + 6000); engine.setTarget(sad());
  assert.equal(engine.snapshot().reason, 'heartbeat'); assert.deepEqual(driver.outputs, zeros);
  engine.start(); time(INTO_RELEASE + 5999); engine.tick();
  assert.equal(engine.snapshot().enabled, false);
});

test('snapshots and input recipes cannot mutate engine state and logs remain bounded', () => {
  const {engine, advance} = setup();
  const recipe = happy(); engine.setTarget(recipe); engine.start();
  recipe.percentages.bergamot = 0;
  recipe.emotionWeights.happiness = 0;
  recipe.contributions.bergamot.happiness = 999;
  const snapshot = engine.snapshot(); snapshot.activeRecipe.percentages.bergamot = 0;
  snapshot.logs[0].message = 'changed'; snapshot.targetRecipe.percentages.bergamot = 0;
  snapshot.activeRecipe.emotionWeights.happiness = 0;
  snapshot.targetRecipe.contributions.bergamot.happiness = 999;
  snapshot.smoothedRecipe.emotionWeights.happiness = 0;
  assert.equal(engine.snapshot().activeRecipe.percentages.bergamot, 32);
  assert.equal(engine.snapshot().activeRecipe.emotionWeights.happiness, 1);
  assert.equal(engine.snapshot().targetRecipe.contributions.bergamot.happiness, 32);
  assert.notEqual(engine.snapshot().logs[0].message, 'changed');
  advance(CYCLE * 3);
  assert.equal(engine.snapshot().logs.length, 8);
  assert.equal(engine.snapshot().cycles, 4);
});

test('explicit session clear erases recipe, smoothing, cycle count and prior logs', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(CYCLE + INTO_RELEASE);
  const state = engine.stop('cleared');
  assert.equal(state.targetRecipe, null); assert.equal(state.smoothedRecipe, null);
  assert.equal(state.activeRecipe, null); assert.equal(state.cycles, 0);
  assert.equal(state.logs.length, 1); assert.equal(state.logs[0].code, null);
  assert.equal(state.logs[0].message, '本轮已清空'); assert.deepEqual(driver.outputs, zeros);
});

test('dispose clears outputs and prevents restarting without creating timers or hardware connections', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(INTO_RELEASE); engine.dispose();
  assert.equal(driver.simulated, true); assert.equal(driver.disposed, true);
  assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
  assert.throws(() => engine.start(), /已经关闭/);
  engine.setTarget(sad()); engine.tick();
  assert.equal(engine.snapshot().enabled, false); assert.deepEqual(engine.snapshot().outputs, zeros);
});


test('smoothing follows all emotion weights rather than attaching the newest source to old percentages', () => {
  const {engine, advance} = setup();
  const first = recipeForScores({happiness: 3, fear: 1});
  const second = recipeForScores({sadness: 2, anger: 1, surprise: 1});
  engine.setTarget(first); engine.start(); advance(1000); engine.setTarget(second);
  const state = advance(7000);
  const retained = Math.exp(-1);
  for (const emotion of EMOTIONS) {
    const expected = first.emotionWeights[emotion] * retained + second.emotionWeights[emotion] * (1 - retained);
    assert.ok(Math.abs(state.smoothedRecipe.emotionWeights[emotion] - expected) < 1e-8);
  }
  assert.deepEqual(state.smoothedRecipe, recipeForScores(state.smoothedRecipe.emotionWeights));
  assert.deepEqual(state.activeRecipe, first);
  assert.deepEqual(state.targetRecipe, second);
  for (const {key} of CHANNELS) {
    assert.equal(Object.values(state.smoothedRecipe.contributions[key]).reduce((sum, points) => sum + Math.round(points * 10), 0), state.smoothedRecipe.percentages[key] * 10);
  }
});

test('same rounded proportions still report a pending change when their sources differ', () => {
  const {engine, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(1000);
  const almostHappy = recipeForScores({happiness: .99999, sadness: .00001});
  assert.equal(almostHappy.code, happy().code);
  engine.setTarget(almostHappy);
  assert.equal(engine.snapshot().pending, true);
  assert.equal(engine.snapshot().activeRecipe.emotionWeights.sadness, 0);
  assert.equal(engine.snapshot().targetRecipe.emotionWeights.sadness, .00001);
  const logs = engine.snapshot().logs.length;
  engine.setTarget(almostHappy);
  assert.equal(engine.snapshot().logs.length, logs);
  assert.equal(engine.snapshot().cycles, 1);
});

test('manual recipes smooth without inventing a source and clear restores attribution', () => {
  const {engine, advance} = setup();
  const manual = normalizeRecipe({percentages: {...zeros, bergamot: 100}});
  engine.setTarget(happy()); engine.start(); advance(1000); engine.setTarget(manual);
  const blended = advance(7000);
  assert.ok(blended.smoothedRecipe.percentages.bergamot > 32);
  assert.ok(blended.smoothedRecipe.percentages.bergamot < 100);
  assert.equal(blended.smoothedRecipe.emotionWeights, null);
  assert.equal(blended.smoothedRecipe.contributions, null);
  assert.deepEqual(blended.activeRecipe, happy());
  engine.setTarget(sad());
  assert.equal(advance(8000).smoothedRecipe.emotionWeights, null);
  engine.stop('cleared');
  engine.setTarget(sad()); engine.start();
  assert.deepEqual(engine.snapshot().activeRecipe, sad());
  engine.setTarget(null);
  assert.equal(engine.snapshot().smoothedRecipe, null);
  engine.setTarget(happy());
  assert.deepEqual(engine.snapshot().activeRecipe, happy());
});
