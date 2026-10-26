import {CHANNELS, PHASE_DURATIONS, normalizeRecipe} from './scent-math.mjs';

const zeroChannels = () => Object.fromEntries(CHANNELS.map(({key}) => [key, 0]));
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
const clamp = value => Math.max(0, Math.min(1, value));
const PHASE_LABELS = {mixing: '配方准备', releasing: '模拟释放', purging: '清气模拟', waiting: '间隔等待'};
const NEXT_PHASE = {mixing: 'releasing', releasing: 'purging', purging: 'waiting', waiting: 'mixing'};

// The adapter is intentionally memory-only. No device API or transport exists here.
export class SimulationDriver {
  constructor() { this.outputs = zeroChannels(); this.purge = 0; this.simulated = true; this.disposed = false; }
  setChannels(outputs, purge = 0) {
    if (this.disposed) return;
    this.outputs = Object.fromEntries(CHANNELS.map(({key}) => [key,
      Number.isFinite(outputs?.[key]) ? Math.max(0, Math.min(100, outputs[key])) : 0]));
    this.purge = Number.isFinite(purge) ? clamp(purge) : 0;
  }
  clear() { this.outputs = zeroChannels(); this.purge = 0; }
  dispose() { this.clear(); this.disposed = true; }
}

export class ScentSimulator {
  constructor({now = () => performance.now(), driver = new SimulationDriver()} = {}) {
    this._now = now;
    this.driver = driver;
    this.enabled = false;
    this.phase = 'stopped';
    this.reason = 'not-started';
    this.cycles = 0;
    this._target = null;
    this._active = null;
    this._smoothed = null;
    this._smoothAt = null;
    this._phaseAt = null;
    this._lastTick = null;
    this._logs = [];
    this._disposed = false;
    this.driver.clear();
  }

  _time(now) {
    const at = now ?? this._now();
    if (!Number.isFinite(at)) throw new TypeError('模拟时钟必须是有限的毫秒数');
    return at;
  }

  _log(type, message, at) {
    this._logs.unshift({at, type, message, code: this._active?.code ?? this._target?.code ?? null});
    this._logs = this._logs.slice(0, 8);
  }

  _smooth(at) {
    if (!this._target || !this._smoothed) { this._smoothAt = at; return; }
    const delta = Math.max(0, at - (this._smoothAt ?? at));
    const amount = 1 - Math.exp(-delta / 6000);
    for (const {key} of CHANNELS) {
      this._smoothed[key] += amount * (this._target.percentages[key] - this._smoothed[key]);
    }
    this._smoothAt = Math.max(this._smoothAt ?? at, at);
  }

  _smoothedRecipe() {
    return this._smoothed ? normalizeRecipe({percentages: this._smoothed, dominant: this._target?.dominant}) : null;
  }

  _beginCycle(at) {
    this._active = this._smoothedRecipe();
    this.phase = this._active ? 'mixing' : 'idle';
    this._phaseAt = this._active ? at : null;
    if (this._active) {
      this.cycles++;
      this._log('mixing', `第 ${this.cycles} 轮 · 配方准备`, at);
    }
  }

  _output() {
    const outputs = this.enabled && this.phase === 'releasing' && this._active
      ? {...this._active.percentages} : zeroChannels();
    const purge = this.enabled && this.phase === 'purging' ? 1 : 0;
    this.driver.setChannels(outputs, purge);
  }

  _heartbeat(at) {
    if (this.enabled && this._lastTick !== null && (at - this._lastTick > 2000 || at < this._lastTick)) {
      this.stop('heartbeat', at);
      return false;
    }
    return true;
  }

  setTarget(recipe, now) {
    if (this._disposed) return this.snapshot(now);
    const at = this._time(now);
    this._heartbeat(at);
    this._smooth(at);
    const next = normalizeRecipe(recipe);
    const changed = next?.code !== this._target?.code;
    this._target = next;
    if (!next) {
      const hadActive = this._active !== null;
      this._active = null;
      this._smoothed = null;
      this._phaseAt = null;
      this._smoothAt = at;
      this.phase = this.enabled ? 'idle' : 'stopped';
      if (this.enabled) this.reason = 'target-missing';
      this.driver.clear();
      if (hadActive) this._log('cleared', '群体数据已清空 · 模拟输出归零', at);
    } else {
      if (!this._smoothed) this._smoothed = {...next.percentages};
      this._smoothAt = at;
      if (changed && this._active) this._log('target', '新配方已接收 · 下一轮更新', at);
      if (this.enabled && this.phase === 'idle') {
        this.reason = null;
        this._beginCycle(at);
        this._output();
      }
    }
    return this.snapshot(at);
  }

  start(now) {
    const at = this._time(now);
    if (this._disposed) throw new Error('气味模拟器已经关闭');
    if (this.enabled) return this.tick(at);
    this._smooth(at);
    this.enabled = true;
    this.reason = this._target ? null : 'target-missing';
    this._lastTick = at;
    this._beginCycle(at);
    if (!this._target) this._log('idle', '模拟已开启 · 等待群体数据', at);
    this._output();
    return this.snapshot(at);
  }

  stop(reason = 'manual', now) {
    const at = this._time(now);
    const wasActive = this.enabled || this._active !== null;
    this.enabled = false;
    this.phase = 'stopped';
    this.reason = reason;
    this._active = null;
    this._phaseAt = null;
    this._lastTick = at;
    this.driver.clear();
    if (reason === 'cleared') {
      this._target = null;
      this._smoothed = null;
      this._smoothAt = at;
      this.cycles = 0;
      this._logs = [];
      this._log('cleared', '本轮已清空', at);
    } else if (wasActive) this._log('stopped', reason === 'heartbeat' ? '页面调度中断 · 模拟已停止' : '模拟已停止 · 输出归零', at);
    return this.snapshot(at);
  }

  tick(now) {
    const at = this._time(now);
    if (this._disposed || !this._heartbeat(at)) return this.snapshot(at);
    this._lastTick = at;
    if (this.enabled && this._target) {
      if (this.phase === 'idle') {
        this._smooth(at);
        this._beginCycle(at);
      }
      while (this._phaseAt !== null && at - this._phaseAt >= PHASE_DURATIONS[this.phase]) {
        const boundary = this._phaseAt + PHASE_DURATIONS[this.phase];
        this._smooth(boundary);
        const next = NEXT_PHASE[this.phase];
        if (next === 'mixing') this._beginCycle(boundary);
        else {
          this.phase = next;
          this._phaseAt = boundary;
          this._log(next, `第 ${this.cycles} 轮 · ${PHASE_LABELS[next]}`, boundary);
        }
      }
    }
    this._smooth(at);
    this._output();
    return this.snapshot(at);
  }

  snapshot(now) {
    const at = this._time(now);
    const duration = PHASE_DURATIONS[this.phase] ?? 0;
    const elapsed = this._phaseAt === null ? 0 : Math.max(0, at - this._phaseAt);
    return {
      simulated: true,
      enabled: this.enabled,
      phase: this.phase,
      remaining: duration ? Math.max(0, duration - elapsed) / 1000 : 0,
      progress: duration ? clamp(elapsed / duration) : 0,
      activeRecipe: copy(this._active),
      targetRecipe: copy(this._target),
      smoothedRecipe: this._smoothedRecipe(),
      pending: Boolean(this._active && this._target && this._active.code !== this._target.code),
      outputs: this.enabled && this.phase === 'releasing' && this._active ? {...this._active.percentages} : zeroChannels(),
      purge: this.enabled && this.phase === 'purging' ? 1 : 0,
      cycles: this.cycles,
      reason: this.reason,
      logs: copy(this._logs),
    };
  }

  dispose(now) {
    this.stop('disposed', now);
    this.driver.dispose();
    this._disposed = true;
  }
}
