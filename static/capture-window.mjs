export const CAPTURE_POLICY = Object.freeze({durationMs: 1500, minFrames: 6, frameIntervalMs: 150, minimumLoopDelayMs: 40});
export const CAPTURE_DURATION_LABEL = `${CAPTURE_POLICY.durationMs / 1000} 秒`;

/** A single explicit capture. Live results alone never open or finish a window. */
export class CaptureWindow {
  constructor({startedAt, scoreKeys}) {
    if (!Number.isFinite(startedAt) || !Array.isArray(scoreKeys) || !scoreKeys.length || new Set(scoreKeys).size !== scoreKeys.length) throw new TypeError('无效采集窗口');
    this.startedAt = startedAt;
    this.endsAt = startedAt + CAPTURE_POLICY.durationMs;
    this._keys = [...scoreKeys];
    this._frames = new Map();
    this._lastFrameAt = -Infinity;
    this._best = null;
    this._active = true;
  }

  progress(now) {
    return Number.isFinite(now) ? Math.max(0, Math.min(1, (now - this.startedAt) / CAPTURE_POLICY.durationMs)) : 0;
  }

  recordFrame({startedAt, completedAt, result} = {}) {
    if (!this._active || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)
      || startedAt < this.startedAt || startedAt >= this.endsAt || completedAt < startedAt
      || completedAt > this.endsAt || startedAt <= this._lastFrameAt || result?.status !== 'ok'
      || !Number.isFinite(result.quality) || result.quality < 0) return null;
    const values = this._keys.map(key => result.scores?.[key]);
    if (values.some(value => !Number.isFinite(value) || value < 0)) return null;
    const max = Math.max(...values);
    if (!max) return null;
    const scaled = values.map(value => value / max);
    const total = scaled.reduce((sum, value) => sum + value, 0);
    const token = Object.freeze({quality: result.quality});
    this._frames.set(token, {completedAt,
      scores: Object.fromEntries(this._keys.map((key, index) => [key, scaled[index] / total])),
      anchors: structuredClone(result.photo_anchors || {}),
    });
    this._lastFrameAt = startedAt;
    return token;
  }

  needsPhoto(token) {
    return this._active && this._frames.has(token) && (!this._best || token.quality > this._best.quality);
  }

  attachPhoto(token, blob, completedAt) {
    const frame = this._frames.get(token);
    if (!blob || !frame || !this.needsPhoto(token) || !Number.isFinite(completedAt)
      || completedAt < frame.completedAt || completedAt > this.endsAt) return false;
    this._best = {blob, anchors: frame.anchors, quality: token.quality};
    return true;
  }

  finish(now) {
    if (!this._active) return {status: 'cancelled'};
    if (!Number.isFinite(now)) throw new TypeError('无效采集时钟');
    if (now < this.endsAt) return {status: 'pending', remainingMs: this.endsAt - now};
    this._active = false;
    const frameCount = this._frames.size;
    if (frameCount < CAPTURE_POLICY.minFrames || !this._best) return {
      status: 'rejected', frameCount,
      reason: frameCount < CAPTURE_POLICY.minFrames ? 'insufficient-frames' : 'missing-photo',
    };
    const frames = [...this._frames.values()];
    const scores = Object.fromEntries(this._keys.map(key => [key,
      frames.reduce((sum, frame) => sum + frame.scores[key], 0) / frameCount]));
    return {status: 'completed', frameCount, scores,
      photo: {blob: this._best.blob, anchors: structuredClone(this._best.anchors)}};
  }

  cancel() {
    this._active = false;
    this._frames.clear();
    this._best = null;
  }
}
