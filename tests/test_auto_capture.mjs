import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoCaptureGate} from '../static/auto-capture.mjs';

const ready = {validFace: true, modelReady: true, canSubmit: true, busy: false};

test('opening the camera arms capture, but face, model, consent and idle state must all be ready', () => {
  const gate = new AutoCaptureGate();
  assert.equal(gate.waiting, false);
  assert.equal(gate.claim(ready), false, 'camera frames alone do not authorize automatic capture');
  gate.arm();
  for (const missing of [{validFace: false}, {modelReady: false}, {canSubmit: false}, {busy: true}]) {
    for (let frame = 0; frame < 20; frame++) assert.equal(gate.claim({...ready, ...missing}), false);
    assert.equal(gate.waiting, true);
  }
  assert.equal(gate.claim(), false, 'missing readiness information is not consent');
  assert.equal(gate.claim({...ready, canSubmit: 'yes'}), false, 'consent must be explicit');
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(gate.claim(ready), true, 'waiting for readiness does not consume retry attempts');
    gate.reject();
  }
  assert.equal(gate.waiting, false);
});

test('repeated frames claim one capture, and a completed capture never starts an endless submission loop', () => {
  const gate = new AutoCaptureGate();
  gate.arm();
  let captures = 0;
  for (let frame = 0; frame < 100; frame++) captures += Number(gate.claim(ready));
  assert.equal(captures, 1);
  assert.equal(gate.waiting, false);
  gate.complete();
  for (let frame = 0; frame < 100; frame++) captures += Number(gate.claim(ready));
  assert.equal(captures, 1);
  assert.equal(gate.reject(), false, 'a late rejection cannot restart a completed capture');
  assert.equal(gate.claim(ready), false);
});

test('quality failures can retry at most three capture windows per camera opening', () => {
  const gate = new AutoCaptureGate();
  gate.arm();
  assert.equal(gate.reject(), false, 'an unclaimed frame is not a failed capture window');
  assert.equal(gate.waiting, true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(gate.claim(ready), true);
    assert.equal(gate.claim(ready), false);
    assert.equal(gate.reject(), attempt < 3);
    assert.equal(gate.reject(), false, 'duplicate rejection does not grant another attempt');
  }
  assert.equal(gate.waiting, false);
  for (let frame = 0; frame < 100; frame++) assert.equal(gate.claim(ready), false);
});

test('consent still gates a retry after a quality failure', () => {
  const gate = new AutoCaptureGate();
  gate.arm();
  assert.equal(gate.claim(ready), true);
  assert.equal(gate.reject(), true);
  assert.equal(gate.claim({...ready, canSubmit: false}), false);
  assert.equal(gate.waiting, true);
  assert.equal(gate.claim(ready), true);
  gate.complete();
  assert.equal(gate.claim(ready), false);
});

test('closing the camera cancels waiting or in-flight capture, and reopening resets the attempt budget', () => {
  for (const inFlight of [false, true]) {
    const gate = new AutoCaptureGate();
    gate.arm();
    if (inFlight) assert.equal(gate.claim(ready), true);
    gate.cancel();
    assert.equal(gate.waiting, false);
    assert.equal(gate.reject(), false, 'a late quality rejection cannot undo cancellation');
    assert.equal(gate.claim(ready), false);
    for (let opening = 0; opening < 2; opening++) {
      gate.arm();
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal(gate.claim(ready), true);
        gate.reject();
      }
      assert.equal(gate.claim(ready), false);
    }
  }
});
