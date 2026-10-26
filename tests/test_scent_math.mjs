import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNELS, EMOTIONS, SCENT_PROFILES, normalizeRecipe, recipeForScores} from '../static/scent-math.mjs';

test('missing, all-zero, unknown and invalid scores never become a neutral recipe', () => {
  for (const scores of [null, undefined, {}, {neutral: 0}, {surprised: 1}, {happiness: NaN, fear: Infinity, sadness: -1}]) {
    assert.equal(recipeForScores(scores), null);
  }
});

test('each of the eight artistic profiles produces a different valid recipe', () => {
  const codes = new Set();
  for (const emotion of EMOTIONS) {
    const recipe = recipeForScores({[emotion]: 1});
    assert.deepEqual(Object.values(recipe.percentages), SCENT_PROFILES[emotion]);
    assert.equal(recipe.dominant, emotion);
    assert.equal(Object.values(recipe.percentages).reduce((a, b) => a + b), 100);
    codes.add(recipe.code);
  }
  assert.equal(codes.size, EMOTIONS.length);
});

test('group recipes use weighted blends, independent of score scale', () => {
  const recipe = recipeForScores({happiness: 3, sadness: 1});
  assert.deepEqual(recipe.percentages, {citrus: 44, floral: 25, wood: 19, herbal: 12});
  assert.deepEqual(recipeForScores({happiness: .75, sadness: .25}), recipe);
  assert.equal(recipe.dominant, 'happiness');
});

test('largest-remainder rounding stays deterministic and always totals 100', () => {
  const recipe = normalizeRecipe({percentages: {citrus: 1, floral: 1, wood: 1, herbal: 0}});
  assert.deepEqual(recipe.percentages, {citrus: 34, floral: 33, wood: 33, herbal: 0});
  for (let i = 1; i < 100; i++) {
    const mixed = recipeForScores({happiness: i, sadness: 100 - i, anger: i / 3});
    assert.ok(Object.values(mixed.percentages).every(Number.isInteger));
    assert.equal(Object.values(mixed.percentages).reduce((a, b) => a + b), 100);
    assert.deepEqual(normalizeRecipe(mixed), mixed);
  }
});

test('finite huge scores are normalized without overflow', () => {
  assert.deepEqual(recipeForScores({happiness: 1e308, sadness: 1e308}), recipeForScores({happiness: 1, sadness: 1}));
});

test('recipe codes identify exact proportions and cannot be supplied by callers', () => {
  const recipe = normalizeRecipe({code: 'wrong', percentages: {citrus: 100, floral: 0, wood: 0, herbal: 0}, dominant: 'unknown'});
  assert.equal(recipe.code, 'SC-100-00-00-00');
  assert.equal(recipe.dominant, null);
  assert.notEqual(recipe.code, normalizeRecipe({percentages: {citrus: 99, floral: 1, wood: 0, herbal: 0}}).code);
  assert.equal(normalizeRecipe({percentages: {citrus: -1, floral: NaN}}), null);
  assert.deepEqual(CHANNELS.map(channel => channel.label), ['柑橘', '花香', '木质', '草本']);
});
