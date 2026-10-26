import test from 'node:test';
import assert from 'node:assert/strict';
import {ScentSimulator, SimulationDriver} from '../static/scent-engine.mjs';
import {recipeForScores} from '../static/scent-math.mjs';

const happy = () => recipeForScores({happiness: 1});
const sad = () => recipeForScores({sadness: 1});
const zeros = {citrus: 0, floral: 0, wood: 0, herbal: 0};
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

test('default 22-second cycle follows prepare/release/purge/wait with output only during release', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start();
  assert.deepEqual(advance(2999).outputs, zeros);
  const release = advance(3000);
  assert.equal(release.phase, 'releasing');
  assert.equal(release.remaining, 6);
  assert.deepEqual(release.outputs, happy().percentages);
  assert.deepEqual(driver.outputs, release.outputs);
  assert.equal(driver.purge, 0);
  const midway = advance(6000);
  assert.equal(midway.progress, .5); assert.equal(midway.remaining, 3);
  const purge = advance(9000);
  assert.equal(purge.phase, 'purging'); assert.equal(purge.purge, 1);
  assert.deepEqual(purge.outputs, zeros); assert.deepEqual(driver.outputs, zeros);
  const wait = advance(17000);
  assert.equal(wait.phase, 'waiting'); assert.equal(wait.purge, 0);
  assert.deepEqual(wait.outputs, zeros);
  const next = advance(22000);
  assert.equal(next.phase, 'mixing'); assert.equal(next.cycles, 2);
  assert.deepEqual(next.outputs, zeros);
});

test('new emotion is smoothed and pending while active recipe stays latched through the whole cycle', () => {
  const {engine, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(4000);
  engine.setTarget(sad());
  assert.equal(engine.snapshot().pending, true);
  const halfway = advance(8000);
  assert.deepEqual(halfway.activeRecipe, happy());
  assert.deepEqual(halfway.outputs, happy().percentages);
  assert.ok(halfway.smoothedRecipe.percentages.citrus < happy().percentages.citrus);
  assert.ok(halfway.smoothedRecipe.percentages.citrus > sad().percentages.citrus);
  assert.deepEqual(advance(21999).activeRecipe, happy());
  const next = advance(22000);
  assert.notDeepEqual(next.activeRecipe.percentages, happy().percentages);
  assert.ok(next.activeRecipe.percentages.citrus < 15);
  assert.equal(Object.values(next.activeRecipe.percentages).reduce((a, b) => a + b), 100);
});

test('repeating targets does not restart cycles or slow exponential convergence', () => {
  const a = setup(); const b = setup();
  for (const run of [a, b]) { run.engine.setTarget(happy()); run.engine.start(); run.advance(1000); run.engine.setTarget(sad()); }
  for (let time = 1200; time <= 7000; time += 200) { a.advance(time); a.engine.setTarget(sad()); }
  b.advance(7000);
  assert.deepEqual(a.engine.snapshot().smoothedRecipe, b.engine.snapshot().smoothedRecipe);
  assert.equal(a.engine.snapshot().smoothedRecipe.percentages.citrus, 27);
  assert.equal(a.engine.snapshot().phase, 'releasing');
  assert.equal(a.engine.snapshot().remaining, 2);
  assert.equal(a.engine.snapshot().cycles, 1);
});

test('clearing valid input while releasing immediately zeroes output and forgets old active/pending data', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(4000); engine.setTarget(sad());
  const cleared = engine.setTarget(null);
  assert.equal(cleared.phase, 'idle'); assert.equal(cleared.enabled, true);
  assert.equal(cleared.pending, false); assert.equal(cleared.activeRecipe, null);
  assert.equal(cleared.targetRecipe, null); assert.equal(cleared.smoothedRecipe, null);
  assert.deepEqual(cleared.outputs, zeros); assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
  advance(5000); engine.setTarget(sad());
  assert.equal(engine.snapshot().phase, 'mixing');
  assert.deepEqual(engine.snapshot().activeRecipe, sad());
});

test('manual stop persists across new data and keeps the next target available for review', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(4000); engine.stop();
  engine.setTarget(sad()); advance(22000);
  const state = engine.snapshot();
  assert.equal(state.enabled, false); assert.equal(state.phase, 'stopped');
  assert.equal(state.activeRecipe, null); assert.deepEqual(state.targetRecipe, sad());
  assert.equal(state.cycles, 1); assert.deepEqual(state.outputs, zeros); assert.deepEqual(driver.outputs, zeros);
  engine.start(); assert.equal(engine.snapshot().phase, 'mixing'); assert.equal(engine.snapshot().cycles, 2);
});

test('hidden, disconnected and clear stop reasons immediately stop releasing or purging', () => {
  for (const reason of ['hidden', 'disconnected', 'cleared']) {
    for (const time of [4000, 10000]) {
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
  for (const startTime of [1000, 4000]) {
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
  engine.setTarget(happy()); engine.start(); advance(4000);
  time(10000); engine.setTarget(sad());
  assert.equal(engine.snapshot().reason, 'heartbeat'); assert.deepEqual(driver.outputs, zeros);
  engine.start(); time(9999); engine.tick();
  assert.equal(engine.snapshot().enabled, false);
});

test('snapshots and input recipes cannot mutate engine state and logs remain bounded', () => {
  const {engine, advance} = setup();
  const recipe = happy(); engine.setTarget(recipe); engine.start();
  recipe.percentages.citrus = 0;
  const snapshot = engine.snapshot(); snapshot.activeRecipe.percentages.citrus = 0;
  snapshot.logs[0].message = 'changed'; snapshot.targetRecipe.percentages.citrus = 0;
  assert.equal(engine.snapshot().activeRecipe.percentages.citrus, 55);
  assert.notEqual(engine.snapshot().logs[0].message, 'changed');
  advance(66000);
  assert.equal(engine.snapshot().logs.length, 8);
  assert.equal(engine.snapshot().cycles, 4);
});

test('explicit session clear erases recipe, smoothing, cycle count and prior logs', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(25000);
  const state = engine.stop('cleared');
  assert.equal(state.targetRecipe, null); assert.equal(state.smoothedRecipe, null);
  assert.equal(state.activeRecipe, null); assert.equal(state.cycles, 0);
  assert.equal(state.logs.length, 1); assert.equal(state.logs[0].code, null);
  assert.equal(state.logs[0].message, '本轮已清空'); assert.deepEqual(driver.outputs, zeros);
});

test('dispose clears outputs and prevents restarting without creating timers or hardware connections', () => {
  const {engine, driver, advance} = setup();
  engine.setTarget(happy()); engine.start(); advance(4000); engine.dispose();
  assert.equal(driver.simulated, true); assert.equal(driver.disposed, true);
  assert.deepEqual(driver.outputs, zeros); assert.equal(driver.purge, 0);
  assert.throws(() => engine.start(), /已经关闭/);
  engine.setTarget(sad()); engine.tick();
  assert.equal(engine.snapshot().enabled, false); assert.deepEqual(engine.snapshot().outputs, zeros);
});
