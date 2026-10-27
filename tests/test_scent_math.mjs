import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNELS, EMOTIONS, EMOTION_LABELS, SCENT_PROFILES, normalizeRecipe, recipeForScores, explainIngredient} from '../static/scent-math.mjs';

const channels = values => Object.fromEntries(CHANNELS.map(({key}, index) => [key, values[index] ?? 0]));
const sum = values => values.reduce((a, b) => a + b, 0);
function assertAttributed(recipe) {
  assert.deepEqual(Object.keys(recipe.emotionWeights), EMOTIONS);
  assert.ok(Math.abs(sum(Object.values(recipe.emotionWeights)) - 1) < 1e-9);
  for (const {key} of CHANNELS) {
    assert.deepEqual(Object.keys(recipe.contributions[key]), EMOTIONS);
    const tenths = Object.values(recipe.contributions[key]).map(value => {
      assert.ok(value >= 0);
      assert.ok(Math.abs(value * 10 - Math.round(value * 10)) < 1e-8);
      return Math.round(value * 10);
    });
    assert.equal(sum(tenths), recipe.percentages[key] * 10);
    for (const emotion of EMOTIONS) {
      if (!recipe.emotionWeights[emotion]) assert.equal(recipe.contributions[key][emotion], 0);
    }
  }
}

test('missing, all-zero, unknown and invalid scores never become a neutral recipe', () => {
  for (const scores of [null, undefined, {}, {neutral: 0}, {surprised: 1}, {happiness: NaN, fear: Infinity, sadness: -1}]) {
    assert.equal(recipeForScores(scores), null);
  }
});

test('eight ingredients each have complete authored material descriptions', () => {
  assert.deepEqual(CHANNELS.map(channel => channel.key), ['bergamot', 'neroli', 'lavender', 'greenleaf', 'cedar', 'vetiver', 'frankincense', 'pepper']);
  assert.deepEqual(CHANNELS.map(channel => channel.label), ['佛手柑', '橙花', '薰衣草', '绿叶', '雪松', '岩兰草', '乳香', '黑胡椒']);
  for (const channel of CHANNELS) {
    for (const key of ['label', 'color', 'family', 'character', 'story']) assert.ok(channel[key]);
    assert.ok(Object.isFrozen(channel));
  }
  assert.deepEqual(Object.keys(EMOTION_LABELS), EMOTIONS);
});

test('each of the eight artistic profiles produces a different valid attributed recipe', () => {
  const codes = new Set();
  for (const emotion of EMOTIONS) {
    const recipe = recipeForScores({[emotion]: 1});
    assert.deepEqual(Object.values(recipe.percentages), SCENT_PROFILES[emotion]);
    assert.equal(recipe.dominant, emotion);
    assert.equal(sum(Object.values(recipe.percentages)), 100);
    assertAttributed(recipe);
    for (const {key} of CHANNELS) assert.equal(recipe.contributions[key][emotion], recipe.percentages[key]);
    codes.add(recipe.code);
  }
  assert.equal(codes.size, EMOTIONS.length);
});

test('group recipes use weighted blends and retain actual mixed sources independent of score scale', () => {
  const recipe = recipeForScores({happiness: 3, sadness: 1});
  assert.deepEqual(recipe.percentages, channels([25, 22, 14, 11, 11, 8, 6, 3]));
  assert.deepEqual(recipeForScores({happiness: .75, sadness: .25}), recipe);
  assert.equal(recipe.dominant, 'happiness');
  assert.equal(recipe.emotionWeights.happiness, .75);
  assert.equal(recipe.emotionWeights.sadness, .25);
  assertAttributed(recipe);
  // The rounded 25% bergamot channel retains both 24 and 1.25 raw source points.
  assert.equal(recipe.contributions.bergamot.happiness, 23.8);
  assert.equal(recipe.contributions.bergamot.sadness, 1.2);
});

test('largest-remainder rounding is deterministic and always totals 100, with additive explanations', () => {
  const recipe = normalizeRecipe({percentages: channels([1, 1, 1])});
  assert.deepEqual(recipe.percentages, channels([34, 33, 33]));
  for (let i = 1; i < 100; i++) {
    const mixed = recipeForScores({happiness: i, sadness: 100 - i, anger: i / 3, fear: .01});
    assert.ok(Object.values(mixed.percentages).every(Number.isInteger));
    assert.equal(sum(Object.values(mixed.percentages)), 100);
    assertAttributed(mixed);
    assert.deepEqual(normalizeRecipe(mixed), mixed);
  }
});

test('finite huge scores are normalized without overflow', () => {
  assert.deepEqual(recipeForScores({happiness: 1e308, sadness: 1e308}), recipeForScores({happiness: 1, sadness: 1}));
});

test('recipe codes identify exact proportions and cannot be supplied by callers', () => {
  const recipe = normalizeRecipe({code: 'wrong', percentages: channels([100]), dominant: 'unknown'});
  assert.equal(recipe.code, 'SC-100-00-00-00-00-00-00-00');
  assert.equal(recipe.dominant, null);
  assert.notEqual(recipe.code, normalizeRecipe({percentages: channels([99, 1])}).code);
  assert.equal(normalizeRecipe({percentages: {bergamot: -1, neroli: NaN}}), null);
});

test('manual recipes are accepted without fabricating emotional provenance', () => {
  const manual = normalizeRecipe({percentages: channels([10, 10, 20, 20, 10, 10, 10, 10]), dominant: 'happiness'});
  assert.equal(manual.emotionWeights, null);
  assert.equal(manual.contributions, null);
  const explanation = explainIngredient(manual, 'bergamot');
  assert.equal(explanation.percent, 10);
  assert.deepEqual(explanation.contributions, []);
  assert.match(explanation.rationale, /没有情绪来源/);
  assert.deepEqual(normalizeRecipe(manual), manual);
});

test('inconsistent sources are discarded and supplied contribution objects are always recomputed', () => {
  const original = recipeForScores({happiness: 2, anger: 1});
  const forged = structuredClone(original);
  forged.contributions.bergamot.fear = 900;
  assert.deepEqual(normalizeRecipe(forged), original);
  forged.emotionWeights = {fear: 1};
  const rejected = normalizeRecipe(forged);
  assert.deepEqual(rejected.percentages, original.percentages);
  assert.equal(rejected.emotionWeights, null);
  assert.equal(rejected.contributions, null);
});

test('ingredient explanations report sorted real contributions and authored rationale', () => {
  const recipe = recipeForScores({happiness: 3, sadness: 1});
  const explanation = explainIngredient(recipe, 'bergamot');
  assert.equal(explanation.percent, 25);
  assert.deepEqual(explanation.contributions, [
    {emotion: 'happiness', weight: .75, points: 23.8},
    {emotion: 'sadness', weight: .25, points: 1.2},
  ]);
  assert.match(explanation.rationale, /艺术映射/);
  assert.match(explanation.rationale, /快乐贡献 23.8/);
  assert.match(explanation.rationale, /悲伤贡献 1.2/);
  assert.deepEqual(explainIngredient(null, 'bergamot').contributions, []);
  assert.equal(explainIngredient(recipe, 'unknown').percent, 0);
});
