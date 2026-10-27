import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserEmotionAnalyzer, CLASS_ORDER, MODEL_SOURCE, preprocessRgba, scoresFromLogits, alignmentAnchors, sharpnessVariance} from '../static/browser-inference.mjs';

test('RGB normalization writes NCHW planes and excludes alpha', () => {
  const data = preprocessRgba(new Uint8ClampedArray([255, 0, 128, 0, 0, 255, 64, 255]), 2, 1);
  const expected = [(1 - .485) / .229, (0 - .485) / .229, (0 - .456) / .224, (1 - .456) / .224, (128 / 255 - .406) / .225, (64 / 255 - .406) / .225];
  assert.equal(data.length, 6);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(data[i] - expected[i]) < 1e-6);
  assert.throws(() => preprocessRgba(new Uint8Array(3), 1, 1));
});

test('model order stays original and stable softmax handles large logits', () => {
  assert.deepEqual(CLASS_ORDER, ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']);
  const scores = scoresFromLogits([9998, 9998, 9998, 9998, 10000, 9998, 9998, 9998]);
  assert.ok(scores.happiness > .5);
  assert.ok(Math.abs(Object.values(scores).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.throws(() => scoresFromLogits([0, 0, 0, 0, NaN, 0, 0, 0]));
  assert.throws(() => scoresFromLogits([1, 2]));
  assert.deepEqual(Object.values(scoresFromLogits(new Float32Array(8))), new Array(8).fill(.125));
});

test('anchors retain full-frame coordinates and sort eyes by image x', () => {
  const marks = Array.from({length: 478}, () => ({x: .5, y: .5}));
  marks[33] = marks[133] = {x: .7, y: .3};
  marks[263] = marks[362] = {x: .3, y: .3};
  marks[1] = {x: .5, y: .55}; marks[13] = {x: .45, y: .7}; marks[14] = {x: .55, y: .7};
  const anchors=alignmentAnchors(marks);
  assert.deepEqual(Object.fromEntries(['left_eye','right_eye','nose','mouth'].map(key=>[key,anchors[key]])), {left_eye: [.3, .3], right_eye: [.7, .3], nose: [.5, .55], mouth: [.5, .7]});
});

test('lip anchors distinguish tissue from an open photographed mouth and sort corners', () => {
  const marks = Array.from({length:478},()=>({x:.5,y:.5}));
  marks[61]={x:.7,y:.68};marks[291]={x:.3,y:.67};
  marks[0]={x:.50,y:.64};marks[13]={x:.50,y:.68};
  marks[14]={x:.51,y:.77};marks[17]={x:.51,y:.82};
  const anchors=alignmentAnchors(marks);
  assert.deepEqual(anchors.mouth_left,[.3,.67]);assert.deepEqual(anchors.mouth_right,[.7,.68]);
  assert.deepEqual(anchors.mouth_upper_outer,[.50,.64]);assert.deepEqual(anchors.mouth_upper_inner,[.50,.68]);
  assert.deepEqual(anchors.mouth_lower_inner,[.51,.77]);assert.deepEqual(anchors.mouth_lower_outer,[.51,.82]);
  assert(Math.abs(anchors.mouth[0]-.505)<1e-12);assert(Math.abs(anchors.mouth[1]-.725)<1e-12);
  assert.equal(anchors.mouth_upper_contour.length,11);assert.equal(anchors.mouth_lower_contour.length,11);
  assert(anchors.mouth_upper_contour.some(p=>p[0]===.5&&p[1]===.68));
  assert(anchors.mouth_lower_contour.some(p=>p[0]===.51&&p[1]===.77));
});

test('flat image has no sharpness while visible edges have positive sharpness', () => {
  const rgba = new Uint8ClampedArray(32 * 32 * 4).fill(128);
  assert.equal(sharpnessVariance(rgba, 32, 32), 0);
  for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) for (let c = 0; c < 3; c++) rgba[(y * 32 + x) * 4 + c] = 255;
  assert.ok(sharpnessVariance(rgba, 32, 32) > 10);
});

test('classifier source is pinned and integrity metadata is explicit', () => {
  assert.match(MODEL_SOURCE.url, /\/520a051c64cd191521e5934655314e769a319684\//);
  assert.equal(MODEL_SOURCE.bytes, 16039595);
  assert.match(MODEL_SOURCE.sha256, /^[a-f0-9]{64}$/);
});

function fakeWorkerEnvironment() {
  const original = {Worker: globalThis.Worker, OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap};
  const workers = [], bitmaps = [];
  globalThis.Worker = class {
    constructor(url) { this.url = url; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    respond(message, result) { this.onmessage({data: {id: message.id, type: 'result', result}}); }
    terminate() { this.terminated = true; }
  };
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = async () => { const bitmap = {close() { this.closed = true; }}; bitmaps.push(bitmap); return bitmap; };
  return {workers, bitmaps, restore() { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }};
}

test('concurrent initialization uses one worker; analysis preserves data and closes transferred bitmap', async () => {
  const env = fakeWorkerEnvironment();
  const analyzer = new BrowserEmotionAnalyzer();
  try {
    const first = analyzer.init(), second = analyzer.init();
    assert.equal(env.workers.length, 1);
    const worker = env.workers[0];
    worker.respond(worker.messages[0], {ready: true});
    await Promise.all([first, second]); assert.equal(analyzer.ready, true);
    const pending = analyzer.analyze({width: 640, height: 480});
    await Promise.resolve();
    const expected = {status: 'no_face', scores: {}};
    worker.respond(worker.messages[1], expected);
    assert.deepEqual(await pending, expected); assert.equal(env.bitmaps[0].closed, true);
    await analyzer.dispose(); assert.equal(worker.terminated, true); assert.equal(analyzer.ready, false);
  } finally { await analyzer.dispose(); env.restore(); }
});

test('dispose during model initialization cancels pending work without reviving a worker', async () => {
  const env = fakeWorkerEnvironment();
  const analyzer = new BrowserEmotionAnalyzer();
  try {
    const init = analyzer.init();
    await analyzer.dispose();
    await assert.rejects(init, /已关闭/);
    assert.equal(analyzer._pending.size, 0); assert.equal(env.workers[0].terminated, true);
    assert.equal(analyzer.ready, false);
    await assert.rejects(analyzer.init(), /已关闭/);
  } finally { env.restore(); }
});

test('eye and eyebrow anchors keep complete local features in image coordinates',()=>{
 const marks=Array.from({length:478},()=>({x:.5,y:.5}));
 for(const [i,x,y] of [[33,.2,.3],[133,.4,.3],[263,.8,.3],[362,.6,.3],[159,.3,.27],[145,.3,.34],
   [386,.7,.27],[374,.7,.34],[70,.21,.2],[105,.3,.18],[107,.39,.21],[300,.79,.2],[334,.7,.18],[336,.61,.21]])marks[i]={x,y};
 const a=alignmentAnchors(marks);
 assert.deepEqual(a.left_eye_outer,[.2,.3]);assert.deepEqual(a.left_eye_inner,[.4,.3]);
 assert.deepEqual(a.right_eye_outer,[.8,.3]);assert.deepEqual(a.right_eye_inner,[.6,.3]);
 assert.deepEqual(a.left_eye_upper,[.3,.27]);assert.deepEqual(a.right_eye_lower,[.7,.34]);
 assert.deepEqual(a.left_brow_middle,[.3,.18]);assert.deepEqual(a.right_brow_outer,[.79,.2]);
});
