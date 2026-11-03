import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_POLICY, CaptureWindow} from '../static/capture-window.mjs';
import {EMOTION_KEYS} from '../static/session-state.mjs';

const scoresFor = emotion => Object.fromEntries(EMOTION_KEYS.map(key => [key, key === emotion ? 1 : 0]));
const resultFor = (emotion = 'happiness', quality = .8) => ({status: 'ok', scores: scoresFor(emotion), quality,
  photo_anchors: {nose: [.5, .5], marker: emotion}});
const makeWindow = (startedAt = 1000) => new CaptureWindow({startedAt, scoreKeys: EMOTION_KEYS});
function record(run, index, {emotion = 'happiness', quality = .5 + index * .05, photo = true} = {}) {
  const startedAt = run.startedAt + 30 + index * 180;
  const token = run.recordFrame({startedAt, completedAt: startedAt + 70, result: resultFor(emotion, quality)});
  if (photo && token) run.attachPhoto(token, {frame: index}, startedAt + 80);
  return token;
}

test('one explicit window averages six accepted frames and uses the best completed photograph', () => {
  const run = makeWindow();
  for (let index = 0; index < 6; index++) record(run, index, {emotion: index < 4 ? 'happiness' : 'sadness'});
  const result = run.finish(run.endsAt);
  assert.equal(result.status, 'completed');
  assert.equal(result.frameCount, 6);
  assert.equal(result.scores.happiness, 4 / 6);
  assert.equal(result.scores.sadness, 2 / 6);
  assert.deepEqual(result.photo.blob, {frame: 5});
  assert.equal(result.photo.anchors.marker, 'sadness');
  assert.equal(run.finish(run.endsAt + 100).status, 'cancelled', 'a completed window cannot publish a second participant');
});

test('a frame already in flight before the click does not count toward the new participant', () => {
  const run = makeWindow();
  assert.equal(run.recordFrame({startedAt: run.startedAt - 1, completedAt: run.startedAt + 20, result: resultFor()}), null);
  for (let index = 0; index < 5; index++) record(run, index);
  assert.deepEqual(run.finish(run.endsAt), {status: 'rejected', frameCount: 5, reason: 'insufficient-frames'});
});

test('the hard deadline applies even when the timer callback is delayed', () => {
  const run = makeWindow();
  for (let index = 0; index < 5; index++) record(run, index);
  assert.equal(run.recordFrame({startedAt: run.endsAt - 20, completedAt: run.endsAt + .1, result: resultFor()}), null);
  assert.equal(run.recordFrame({startedAt: run.endsAt, completedAt: run.endsAt, result: resultFor()}), null);
  assert.equal(run.recordFrame({startedAt: run.endsAt + 20, completedAt: run.endsAt + 50, result: resultFor()}), null);
  const result = run.finish(run.endsAt + 1000);
  assert.equal(result.status, 'rejected');
  assert.equal(result.frameCount, 5);
});

test('a frame can finish exactly at the deadline, but cannot produce a late photo', () => {
  const run = makeWindow();
  for (let index = 0; index < 5; index++) record(run, index);
  const token = run.recordFrame({startedAt: run.endsAt - 30, completedAt: run.endsAt, result: resultFor('fear', 1)});
  assert.ok(token);
  assert.equal(run.attachPhoto(token, {late: true}, run.endsAt + .1), false);
  const result = run.finish(run.endsAt);
  assert.equal(result.status, 'completed');
  assert.equal(result.scores.fear, 1 / 6);
  assert.deepEqual(result.photo.blob, {frame: 4});
});

test('six valid classifications without an in-window photo cannot add a participant', () => {
  const run = makeWindow();
  let token;
  for (let index = 0; index < 6; index++) token = record(run, index, {photo: false});
  assert.equal(run.attachPhoto(token, {late: true}, run.endsAt + 1), false);
  assert.deepEqual(run.finish(run.endsAt), {status: 'rejected', frameCount: 6, reason: 'missing-photo'});
  assert.equal(run.attachPhoto(token, {later: true}, run.endsAt + 2), false);
});

test('an earlier timer wakeup keeps the window open rather than creating a short capture', () => {
  const run = makeWindow();
  for (let index = 0; index < 6; index++) record(run, index);
  assert.deepEqual(run.finish(run.endsAt - 15), {status: 'pending', remainingMs: 15});
  assert.equal(run.progress(run.endsAt - 15), (CAPTURE_POLICY.durationMs - 15) / CAPTURE_POLICY.durationMs);
  assert.equal(run.finish(run.endsAt).status, 'completed');
});

test('stopping or hiding cancels the window before late inference and photo callbacks arrive', () => {
  const run = makeWindow();
  let token;
  for (let index = 0; index < 6; index++) token = record(run, index);
  run.cancel();
  assert.equal(run.needsPhoto(token), false);
  assert.equal(run.attachPhoto(token, {late: true}, run.endsAt - 10), false);
  assert.equal(run.recordFrame({startedAt: run.endsAt - 20, completedAt: run.endsAt - 10, result: resultFor()}), null);
  assert.equal(run.finish(run.endsAt).status, 'cancelled');
});

test('late work from a cancelled window cannot supply a photograph to a new window', () => {
  const old = makeWindow();
  const oldToken = record(old, 0, {photo: false});
  old.cancel();
  const next = makeWindow(1200);
  assert.equal(next.attachPhoto(oldToken, {wrong: true}, 1300), false);
  for (let index = 0; index < 6; index++) record(next, index, {photo: false});
  assert.equal(next.finish(next.endsAt).reason, 'missing-photo');
});

test('late lower-quality encoding cannot replace a sharper completed photograph', () => {
  const run = makeWindow();
  const low = record(run, 0, {quality: .4, photo: false});
  const high = record(run, 1, {quality: .95, photo: false});
  assert.equal(run.attachPhoto(high, {sharp: true}, run.startedAt + 350), true);
  assert.equal(run.attachPhoto(low, {soft: true}, run.startedAt + 360), false);
  for (let index = 2; index < 6; index++) record(run, index, {quality: .3});
  assert.deepEqual(run.finish(run.endsAt).photo.blob, {sharp: true});
});

test('invalid, duplicate, multiple-face and reversed-time results cannot satisfy the frame threshold', () => {
  const run = makeWindow();
  const valid = {startedAt: 1030, completedAt: 1100, result: resultFor()};
  assert.ok(run.recordFrame(valid));
  assert.equal(run.recordFrame(valid), null);
  for (const status of ['no_face', 'multiple_faces', 'poor_quality', 'error']) {
    assert.equal(run.recordFrame({startedAt: 1200, completedAt: 1300, result: {...resultFor(), status}}), null);
  }
  for (const invalid of [undefined, NaN, -1, Infinity]) {
    assert.equal(run.recordFrame({startedAt: 1200, completedAt: 1300, result: {...resultFor(), quality: invalid}}), null);
    assert.equal(run.recordFrame({startedAt: 1200, completedAt: 1300, result: {...resultFor(), scores: {...scoresFor('happiness'), fear: invalid}}}), null);
  }
  assert.equal(run.recordFrame({startedAt: 1200, completedAt: 1199, result: resultFor()}), null);
  assert.equal(run.recordFrame({startedAt: NaN, completedAt: 1300, result: resultFor()}), null);
  assert.equal(run.recordFrame({startedAt: 1200, completedAt: Infinity, result: resultFor()}), null);
  const result = run.finish(run.endsAt);
  assert.equal(result.status, 'rejected');
  assert.equal(result.frameCount, 1);
});

test('accepted samples and photo anchors are snapshots, independent of caller mutations', () => {
  const run = makeWindow();
  const first = resultFor();
  const token = run.recordFrame({startedAt: 1000, completedAt: 1010, result: first});
  run.attachPhoto(token, {frame: 0}, 1020);
  first.scores.happiness = 0;
  first.scores.fear = 1;
  first.photo_anchors.nose[0] = 99;
  for (let index = 1; index < 6; index++) record(run, index, {quality: .1, emotion: 'happiness'});
  const result = run.finish(run.endsAt);
  assert.equal(result.scores.happiness, 1);
  assert.equal(result.scores.fear, 0);
  assert.deepEqual(result.photo.anchors.nose, [.5, .5]);
});

test('progress stays bounded without changing the frame window or committing a participant', () => {
  const run = makeWindow();
  for (const at of [run.startedAt - 100, NaN, -Infinity]) assert.equal(run.progress(at), 0);
  assert.equal(run.progress(run.endsAt + 100), 1);
  assert.equal(run.finish(run.endsAt).status, 'rejected');
  assert.throws(() => makeWindow(NaN), /无效采集窗口/);
});

const makeAdaptiveWindow = (startedAt = 1000) => new CaptureWindow({startedAt, scoreKeys: EMOTION_KEYS, maxDurationMs: 6000});

test('an optional adaptive window collects six sustained slow frames and completes before its hard deadline', () => {
  const run = makeAdaptiveWindow();
  const slowFrame = index => {
    const startedAt = run.startedAt + 30 + index * 700;
    const completedAt = startedAt + 600;
    const token = run.recordFrame({startedAt, completedAt, result: resultFor('happiness', .5 + index * .05)});
    assert.ok(token);
    assert.equal(run.attachPhoto(token, {frame: index}, completedAt + 10), true);
    return completedAt + 10;
  };
  assert.equal(run.endsAt, run.startedAt + CAPTURE_POLICY.durationMs);
  assert.equal(run.deadlineAt, run.startedAt + 6000);
  slowFrame(0);
  slowFrame(1);
  assert.deepEqual(run.finish(run.endsAt - 1), {status: 'pending', remainingMs: 1, frameCount: 2, extended: false});
  assert.deepEqual(run.finish(run.endsAt), {
    status: 'pending', remainingMs: CAPTURE_POLICY.frameIntervalMs, frameCount: 2, extended: true,
  });
  for (let index = 2; index < 5; index++) {
    const completedAt = slowFrame(index);
    const result = run.finish(completedAt);
    assert.equal(result.status, 'pending');
    assert.equal(result.frameCount, index + 1);
    assert.equal(result.extended, true);
  }
  const completedAt = slowFrame(5);
  assert.ok(completedAt < run.deadlineAt);
  assert.ok(run.progress(completedAt) < 1);
  const result = run.finish(completedAt);
  assert.equal(result.status, 'completed');
  assert.equal(result.frameCount, 6);
  assert.equal(result.scores.happiness, 1);
  assert.deepEqual(result.photo.blob, {frame: 5});
  assert.equal(run.progress(completedAt), 1);
  assert.equal(run.finish(completedAt + 1).status, 'cancelled');
});

test('an adaptive window with sufficient frames and photo still waits for and finishes at the nominal duration', () => {
  const run = makeAdaptiveWindow();
  for (let index = 0; index < 6; index++) record(run, index);
  assert.equal(run.finish(run.endsAt - 1).status, 'pending');
  assert.equal(run.finish(run.endsAt).status, 'completed');
});

test('adaptive capture rejects insufficient frames at six seconds even when its timer fires late', () => {
  const run = makeAdaptiveWindow();
  for (let index = 0; index < 5; index++) record(run, index);
  assert.equal(run.finish(run.endsAt).status, 'pending');
  assert.equal(run.recordFrame({startedAt: run.deadlineAt - 20, completedAt: run.deadlineAt + .1, result: resultFor()}), null);
  assert.equal(run.recordFrame({startedAt: run.deadlineAt, completedAt: run.deadlineAt, result: resultFor()}), null);
  assert.deepEqual(run.finish(run.deadlineAt - 1), {status: 'pending', remainingMs: 1, frameCount: 5, extended: true});
  assert.deepEqual(run.finish(run.deadlineAt + 1000), {status: 'rejected', frameCount: 5, reason: 'insufficient-frames'});
  assert.equal(run.recordFrame({startedAt: run.deadlineAt - 20, completedAt: run.deadlineAt, result: resultFor()}), null);
});

test('adaptive capture waits for a photograph but rejects one encoded beyond the hard deadline', () => {
  const run = makeAdaptiveWindow();
  let token;
  for (let index = 0; index < 6; index++) token = record(run, index, {photo: false});
  assert.deepEqual(run.finish(run.endsAt), {
    status: 'pending', remainingMs: CAPTURE_POLICY.frameIntervalMs, frameCount: 6, extended: true,
  });
  assert.equal(run.attachPhoto(token, {late: true}, run.deadlineAt + .1), false);
  assert.deepEqual(run.finish(run.deadlineAt), {status: 'rejected', frameCount: 6, reason: 'missing-photo'});
  assert.equal(run.attachPhoto(token, {lateCallback: true}, run.deadlineAt), false);
});

test('a photograph completed during extension can finish an otherwise ready capture', () => {
  const run = makeAdaptiveWindow();
  let token;
  for (let index = 0; index < 6; index++) token = record(run, index, {photo: false});
  assert.equal(run.finish(run.endsAt).status, 'pending');
  assert.equal(run.attachPhoto(token, {extended: true}, run.endsAt + 400), true);
  const result = run.finish(run.endsAt + 400);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.photo.blob, {extended: true});
});

test('an adaptive frame may finish at the hard deadline but its photograph cannot finish later', () => {
  const run = makeAdaptiveWindow();
  for (let index = 0; index < 5; index++) record(run, index);
  assert.equal(run.finish(run.endsAt).status, 'pending');
  const token = run.recordFrame({startedAt: run.deadlineAt - 500, completedAt: run.deadlineAt, result: resultFor('fear', 1)});
  assert.ok(token);
  assert.equal(run.attachPhoto(token, {late: true}, run.deadlineAt + .1), false);
  const result = run.finish(run.deadlineAt);
  assert.equal(result.status, 'completed');
  assert.equal(result.scores.fear, 1 / 6);
  assert.deepEqual(result.photo.blob, {frame: 4});
});

test('cancelling an extended window blocks in-flight callbacks and tokens cannot leak into a later capture', () => {
  const old = makeAdaptiveWindow();
  const token = record(old, 0, {photo: false});
  assert.equal(old.finish(old.endsAt).status, 'pending');
  old.cancel();
  assert.equal(old.needsPhoto(token), false);
  assert.equal(old.attachPhoto(token, {stale: true}, old.endsAt + 50), false);
  assert.equal(old.recordFrame({startedAt: old.endsAt - 100, completedAt: old.endsAt + 100, result: resultFor()}), null);
  assert.equal(old.finish(old.endsAt + 100).status, 'cancelled');
  const next = makeAdaptiveWindow(old.endsAt);
  assert.equal(next.attachPhoto(token, {stale: true}, next.startedAt + 50), false);
  assert.equal(next.recordFrame({startedAt: next.startedAt - 1, completedAt: next.startedAt + 100, result: resultFor()}), null);
  assert.equal(next.finish(next.endsAt).frameCount, 0);
});

test('extension preserves strict timestamps, duplicate rejection and invalid-frame filtering', () => {
  const run = makeAdaptiveWindow();
  assert.equal(run.finish(run.endsAt).status, 'pending');
  const frame = {startedAt: run.endsAt + 100, completedAt: run.endsAt + 500, result: resultFor()};
  assert.ok(run.recordFrame(frame));
  assert.equal(run.recordFrame(frame), null);
  assert.equal(run.recordFrame({...frame, startedAt: run.startedAt - 1}), null);
  assert.equal(run.recordFrame({...frame, startedAt: frame.completedAt + 1}), null);
  assert.equal(run.recordFrame({...frame, startedAt: NaN}), null);
  assert.equal(run.recordFrame({...frame, startedAt: frame.startedAt + 1, completedAt: Infinity}), null);
  assert.equal(run.recordFrame({...frame, startedAt: frame.startedAt + 1, result: {...resultFor(), status: 'no_face'}}), null);
  assert.equal(run.finish(run.deadlineAt).frameCount, 1);
});

test('adaptive duration is finite and bounded and pending progress never reaches completion', () => {
  for (const maxDurationMs of [NaN, Infinity, -Infinity, 0, 1499, 6000.1, '6000', null]) {
    assert.throws(() => new CaptureWindow({startedAt: 1000, scoreKeys: EMOTION_KEYS, maxDurationMs}), /无效采集窗口/);
  }
  assert.throws(() => makeAdaptiveWindow(Number.MAX_VALUE), /无效采集窗口/);
  const run = makeAdaptiveWindow();
  assert.equal(run.progress(NaN), 0);
  assert.equal(run.progress(run.startedAt - 1), 0);
  let previous = 0;
  for (let elapsed = 0; elapsed <= 6500; elapsed += 100) {
    const progress = run.progress(run.startedAt + elapsed);
    assert.ok(progress >= previous && progress < 1);
    previous = progress;
  }
  assert.equal(run.finish(run.deadlineAt).status, 'rejected');
  assert.equal(run.progress(run.deadlineAt), 1);
  const fixed = new CaptureWindow({startedAt: 1000, scoreKeys: EMOTION_KEYS, maxDurationMs: CAPTURE_POLICY.durationMs});
  assert.deepEqual(fixed.finish(fixed.endsAt), {status: 'rejected', frameCount: 0, reason: 'insufficient-frames'});
});
