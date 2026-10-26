// Pure geometry and animation checks; no browser, network, or webcam required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABELS, PATCH_SEEDS, normalizeScores, morphWeights,
  affineFromTriangles, voronoiCells, photoTriangle,
} from '../static/portrait-math.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual), `Expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} ≈ ${expected} (tolerance ${tolerance})`);
};
const pointClose = (actual, expected) => actual.forEach((value, i) => close(value, expected[i]));
const applyAffine = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];
const area = points => Math.abs(points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;

for (const emotion of Object.keys(LABELS)) {
  test(`${emotion}: all morph values are finite and remain in [0, 1]`, () => {
    const values = Object.values(morphWeights({[emotion]: 1}));
    assert.ok(values.length > 0);
    assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    if (emotion !== 'neutral') assert.ok(values.some(value => value > 0));
  });
}

test('neutral leaves every expression morph at zero', () => {
  assert.ok(Object.values(morphWeights({neutral: 1})).every(value => value === 0));
});

test('equal-weight participant mixtures produce equal-weight linear morph mixtures', () => {
  const first = {happiness: .8, neutral: .2};
  const second = {sadness: .45, surprise: .25, anger: .3};
  const group = Object.fromEntries(Object.keys(LABELS).map(name => [name, ((first[name] || 0) + (second[name] || 0)) / 2]));
  const firstMorphs = morphWeights(first), secondMorphs = morphWeights(second), combined = morphWeights(group);
  const names = new Set([...Object.keys(firstMorphs), ...Object.keys(secondMorphs)]);
  for (const name of names) close(combined[name] || 0, ((firstMorphs[name] || 0) + (secondMorphs[name] || 0)) / 2);
  close(Object.values(normalizeScores(group)).reduce((sum, value) => sum + value, 0), 1);
});

test('empty, malformed, negative and nonfinite score values never yield NaN morphs', () => {
  for (const scores of [undefined, null, {}, 12, 'unknown', {happiness: NaN},
    {fear: Infinity, sadness: -Infinity, anger: -3}, {happiness: '1', surprise: true},
    {happiness: 2, fear: NaN, neutral: 2, unsupported: 100}]) {
    const weights = morphWeights(scores);
    assert.ok(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  const normalized = normalizeScores({happiness: 2, fear: NaN, neutral: 2, unsupported: 100});
  close(normalized.happiness, .5);
  close(normalized.neutral, .5);
  assert.equal(normalized.fear, 0);
  assert.equal(normalized.unsupported, undefined);
});

test('affine transform reproduces all three anchor correspondences and an interior point', () => {
  const source = [[24, 60], [167, 53], [91, 195]];
  const expected = [1.3, -.2, .35, .8, 18, 39];
  const target = source.map(point => applyAffine(expected, point));
  const actual = affineFromTriangles(source, target);
  assert.ok(actual);
  actual.forEach((value, index) => close(value, expected[index]));
  source.forEach((point, index) => pointClose(applyAffine(actual, point), target[index]));
  pointClose(applyAffine(actual, [82, 100]), applyAffine(expected, [82, 100]));
});

test('affine transform rejects duplicate, collinear and nearly collapsed source anchors', () => {
  const target = [[10, 20], [60, 20], [35, 80]];
  for (const source of [[[0, 0], [0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]],
    [[0, 0], [1, 0], [0, 1e-10]]]) {
    assert.equal(affineFromTriangles(source, target), null);
  }
});

test('affine transform rejects nonfinite or malformed point coordinates', () => {
  const valid = [[0, 0], [1, 0], [0, 1]];
  assert.equal(affineFromTriangles([[NaN, 0], [1, 0], [0, 1]], valid), null);
  assert.equal(affineFromTriangles(valid, [[0, 0], [1, 0], [0, Infinity]]), null);
  assert.equal(affineFromTriangles([[0], [1, 0], [0, 1]], valid), null);
});

test('twenty Voronoi cells have positive area and cover exactly the unit square', () => {
  const cells = voronoiCells();
  assert.equal(cells.length, 20);
  let totalArea = 0;
  for (const polygon of cells) {
    assert.ok(polygon.length >= 3);
    for (const point of polygon) {
      assert.equal(point.length, 2);
      assert.ok(point.every(value => Number.isFinite(value) && value >= -1e-10 && value <= 1 + 1e-10));
    }
    const polygonArea = area(polygon);
    assert.ok(polygonArea > 1e-6, `Zero-sized cell: ${polygonArea}`);
    totalArea += polygonArea;
  }
  close(totalArea, 1);
});

test('every Voronoi vertex belongs to its own seed region', () => {
  const distanceSquared = (first, second) => (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
  voronoiCells().forEach((polygon, index) => {
    for (const point of polygon) {
      const ownDistance = distanceSquared(point, PATCH_SEEDS[index]);
      for (const seed of PATCH_SEEDS) assert.ok(ownDistance <= distanceSquared(point, seed) + 1e-10);
    }
  });
});

test('photoTriangle maps normalized photo anchors to pixel coordinates', () => {
  const anchors = {left_eye: [.2, .3], right_eye: [.7, .31], mouth: [.48, .76], nose: [.5, .5]};
  const points = photoTriangle(anchors, 240, 320);
  assert.equal(points.length, 3);
  points.forEach((point, index) => pointClose(point, [[48, 96], [168, 99.2], [115.2, 243.2]][index]));
  assert.deepEqual(anchors.left_eye, [.2, .3]);
});

test('photoTriangle provides the same fallback for missing anchors and legacy records', () => {
  const expected = [[62, 152], [138, 152], [100, 292]];
  for (const anchors of [null, undefined, {}]) {
    const points = photoTriangle(anchors, 200, 400);
    points.forEach((point, index) => pointClose(point, expected[index]));
  }
});

test('photoTriangle substitutes only invalid anchors while preserving valid points', () => {
  const points = photoTriangle({left_eye: [.2, .25], right_eye: [1.2, .3], mouth: [NaN, .7]}, 200, 400);
  points.forEach((point, index) => pointClose(point, [[40, 100], [138, 152], [100, 292]][index]));
});
