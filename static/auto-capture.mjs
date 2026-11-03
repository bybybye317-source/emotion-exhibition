const MAX_ATTEMPTS = 3;

// One camera opening arms one automatic capture. Only a rejected capture window
// may retry; submission failures must remain in the explicit retry flow.
export class AutoCaptureGate {
  constructor() {
    this._state = 'idle';
    this._attempts = 0;
  }

  get waiting() { return this._state === 'waiting'; }

  arm() {
    this._attempts = 0;
    this._state = 'waiting';
  }

  cancel() { this._state = 'idle'; }

  claim({validFace = false, modelReady = false, canSubmit = false, busy = false} = {}) {
    if (!this.waiting || validFace !== true || modelReady !== true || canSubmit !== true || busy) return false;
    this._attempts += 1;
    this._state = 'claimed';
    return true;
  }

  reject() {
    if (this._state !== 'claimed') return false;
    this._state = this._attempts < MAX_ATTEMPTS ? 'waiting' : 'idle';
    return this.waiting;
  }

  complete() { this._state = 'idle'; }
}
