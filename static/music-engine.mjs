import {MUSIC_BPM, BAR_SECONDS, MUSIC_LAYERS, musicParameters, sanitizeParameters, planBar, midiFrequency} from './music-math.mjs';
import {loadOrchestraSamples, selectOrchestraSample} from './music-samples.mjs';
import {createMusicAnalysis, createVisualFrame, clearVisualFrame} from './music-analysis.mjs';

const MAX_VOICES = 64;
const LOOKAHEAD = .16;
const TICK_MS = 25;
const OUTPUT_GAIN = .88;
const limit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function smooth(parameter, value, now, seconds = 1.2) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
  else { const current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now); }
  parameter.setTargetAtTime(value, now, seconds);
}

function makeNoise(context, seconds, seed = 1994) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const values = buffer.getChannelData(0);
  let state = seed;
  for (let i = 0; i < values.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = state / 2147483648 - 1;
  }
  return buffer;
}

// The electronic layers remain synthesized. Strings and brass use recordings.
// PeriodicWave lets the browser band-limit harmonics at each played pitch.
function makeWaves(context) {
  const wave = (harmonics, shape) => {
    const real = new Float32Array(harmonics + 1), imaginary = new Float32Array(harmonics + 1);
    for (let harmonic = 1; harmonic <= harmonics; harmonic++) imaginary[harmonic] = shape(harmonic);
    return context.createPeriodicWave(real, imaginary);
  };
  return {
    synth: wave(32, n => (n % 2 ? 1 : .42) / n ** 1.06),
    melody: wave(20, n => (n % 2 ? 1 : .58) / n ** 1.28),
    bass: wave(12, n => (n % 2 ? 1 : .62) / n ** 1.65),
  };
}

function hallImpulse(context) {
  const seconds = 5.8;
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const values = impulse.getChannelData(channel);
    const noise = makeNoise(context, seconds, 104729 + channel * 15485863).getChannelData(0);
    let low = 0;
    for (let i = 0; i < values.length; i++) {
      const time = i / context.sampleRate;
      low = low * .52 + noise[i] * .48;
      const arrival = Math.min(1, Math.max(0, (time - .022) / .035));
      values[i] = low * arrival * Math.exp(-time * 1.05);
    }
    // Unequal early reflections give the direct sound an audible hall boundary.
    for (const [delay, gain] of [[.029, .58], [.047, .39], [.073, .24], [.113, .14]]) {
      const offset = Math.floor((delay + channel * .003) * context.sampleRate);
      if (offset < values.length) values[offset] += gain;
    }
  }
  return impulse;
}

const layerSettings = {
  strings: {highpass: 80, cutoff: 3300, range: 6200, send: .36, vibrato: 0, rate: 1},
  brass: {highpass: 65, cutoff: 2700, range: 5900, send: .32, vibrato: 0, rate: 1},
  synth: {highpass: 85, cutoff: 1050, range: 4600, send: .38, vibrato: 4.5, rate: .073},
  bass: {highpass: 28, cutoff: 750, range: 1200, send: .055, vibrato: 0, rate: 1},
  melody: {highpass: 150, cutoff: 2300, range: 6200, send: .48, vibrato: 5.5, rate: .117},
  percussion: {highpass: 32, cutoff: 3900, range: 4700, send: .24, vibrato: 0, rate: 1},
};
const cutoffFor = (layer, p) => layerSettings[layer].cutoff + layerSettings[layer].range * (.72 * p.brightness + .28 * p.dynamics);

function makeGraph(context, parameters, volume, offline = false, samples = null) {
  const nodes = [], voices = new Set(), continuousSources = [];
  // Derived buffers are built once per recording, never once per gesture.
  const reversed = new WeakMap();
  const reverseSustain = sample => {
    if (!reversed.has(sample.buffer)) {
      const start = Math.floor(sample.loopStart * sample.buffer.sampleRate);
      const end = Math.floor(sample.loopEnd * sample.buffer.sampleRate);
      const buffer = context.createBuffer(sample.buffer.numberOfChannels, end - start, sample.buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const input = sample.buffer.getChannelData(channel), output = buffer.getChannelData(channel);
        for (let index = 0; index < output.length; index++) output[index] = input[end - index - 1];
      }
      reversed.set(sample.buffer, buffer);
    }
    return reversed.get(sample.buffer);
  };
  const own = node => { nodes.push(node); return node; };
  const compressor = own(context.createDynamicsCompressor());
  compressor.threshold.value = -15; compressor.knee.value = 12;
  compressor.ratio.value = 2.2; compressor.attack.value = .025; compressor.release.value = .32;
  const master = own(context.createGain()); master.gain.value = offline ? volume * OUTPUT_GAIN : 0;
  const peakLimiter = own(context.createDynamicsCompressor());
  peakLimiter.threshold.value = -3; peakLimiter.knee.value = 0;
  peakLimiter.ratio.value = 20; peakLimiter.attack.value = .001; peakLimiter.release.value = .08;
  const safety = own(context.createWaveShaper());
  // Unity below -2.85 dB; a rounded ceiling above it. No hard-clipping samples.
  safety.curve = Float32Array.from({length: 8193}, (_, index) => {
    const value = index / 4096 - 1, magnitude = Math.abs(value);
    return Math.sign(value) * (magnitude <= .72 ? magnitude : .72 + .25 * Math.tanh((magnitude - .72) / .25));
  });
  compressor.connect(master); master.connect(peakLimiter); peakLimiter.connect(safety); safety.connect(context.destination);
  const reverb = own(context.createConvolver()); reverb.buffer = hallImpulse(context);
  const wetHighpass = own(context.createBiquadFilter()); wetHighpass.type = 'highpass'; wetHighpass.frequency.value = 180;
  const wetLowpass = own(context.createBiquadFilter()); wetLowpass.type = 'lowpass'; wetLowpass.frequency.value = 5700; wetLowpass.Q.value = .5;
  const wet = own(context.createGain()); wet.gain.value = .72 + .30 * parameters.space;
  reverb.connect(wetHighpass); wetHighpass.connect(wetLowpass); wetLowpass.connect(wet); wet.connect(compressor);
  // A pair of unsynchronised, gently moving echoes. Cross-feedback is always
  // below .43 per pass, and each pass removes sub-bass and high-frequency energy.
  const echoes = [0, 1].map(index => {
    const delay = own(context.createDelay(1.5)); delay.delayTime.value = index ? .677 : .431;
    const highpass = own(context.createBiquadFilter()); highpass.type = 'highpass'; highpass.frequency.value = 280;
    const lowpass = own(context.createBiquadFilter()); lowpass.type = 'lowpass'; lowpass.frequency.value = index ? 2900 : 3600;
    const feedback = own(context.createGain()); feedback.gain.value = .25 + .17 * parameters.space;
    const level = own(context.createGain()); level.gain.value = .29 + .21 * parameters.space;
    const pan = own(context.createStereoPanner()); pan.pan.value = index ? .78 : -.78;
    const motion = own(context.createOscillator()); motion.frequency.value = index ? .023 : .037;
    const depth = own(context.createGain()); depth.gain.value = .003 + .009 * parameters.drift;
    motion.connect(depth); depth.connect(delay.delayTime); motion.start(); continuousSources.push(motion);
    delay.connect(highpass); highpass.connect(lowpass); lowpass.connect(feedback);
    lowpass.connect(level); level.connect(pan); pan.connect(compressor); pan.connect(reverb);
    return {delay, feedback, level, depth};
  });
  echoes[0].feedback.connect(echoes[1].delay); echoes[1].feedback.connect(echoes[0].delay);
  const layers = {};
  for (const layer of MUSIC_LAYERS) {
    const settings = layerSettings[layer];
    const input = own(context.createGain());
    const highpass = own(context.createBiquadFilter()); highpass.type = 'highpass'; highpass.frequency.value = settings.highpass; highpass.Q.value = .55;
    const filter = own(context.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = .5; filter.frequency.value = cutoffFor(layer, parameters);
    const gain = own(context.createGain()); gain.gain.value = parameters[layer];
    const send = own(context.createGain()); send.gain.value = settings.send;
    input.connect(highpass); highpass.connect(filter); filter.connect(gain); gain.connect(compressor); gain.connect(send); send.connect(reverb);
    const echoSend = own(context.createGain());
    echoSend.gain.value = ({strings: .055, brass: .025, synth: .25, bass: 0, melody: .49, percussion: .08})[layer];
    gain.connect(echoSend); echoSend.connect(echoes[layer === 'melody' ? 1 : 0].delay);
    let vibrato = null;
    if (settings.vibrato) {
      const lfo = own(context.createOscillator()); lfo.frequency.value = settings.rate;
      vibrato = own(context.createGain()); vibrato.gain.value = settings.vibrato;
      lfo.connect(vibrato); lfo.start(); continuousSources.push(lfo);
    }
    layers[layer] = {input, filter, gain, vibrato};
  }
  const waves = makeWaves(context), noise = makeNoise(context, 3.6);
  const analysis = offline ? null : createMusicAnalysis(context, safety,
    Object.fromEntries(MUSIC_LAYERS.map(layer => [layer, layers[layer].gain])), own);
  let previous = parameters;
  return {
    master, voices, analysis,
    setSamples(bank) { samples = bank; },
    update(next, now, immediate = false) {
      if (Math.abs(next.space - previous.space) > .0005) {
        smooth(wet.gain, .72 + .30 * next.space, now, immediate ? .015 : 2.8);
        for (const echo of echoes) {
          smooth(echo.feedback.gain, .25 + .17 * next.space, now, immediate ? .015 : 2.8);
          smooth(echo.level.gain, .29 + .21 * next.space, now, immediate ? .015 : 2.8);
        }
      }
      if (Math.abs(next.drift - previous.drift) > .0005)
        for (const echo of echoes) smooth(echo.depth.gain, .003 + .009 * next.drift, now, immediate ? .015 : 3.2);
      for (const layer of MUSIC_LAYERS) {
        if (Math.abs(next[layer] - previous[layer]) > .0005) smooth(layers[layer].gain.gain, next[layer], now, immediate ? .015 : 1.4);
        if (Math.abs(next.brightness - previous.brightness) > .0005 || Math.abs(next.dynamics - previous.dynamics) > .0005)
          smooth(layers[layer].filter.frequency, cutoffFor(layer, next), now, immediate ? .015 : 1.7);
      }
      previous = next;
    },
    note(event, when, p) {
      if (!layers[event.layer] || !Number.isFinite(when) || !Number.isFinite(event.duration) || event.duration <= .025) return false;
      if ([...voices].filter(voice => voice.end > when).length >= MAX_VOICES) return false;
      const texture = event.layer === 'melody' && ['grain', 'reverse'].includes(event.kind);
      const sampled = event.layer === 'strings' || event.layer === 'brass' || texture;
      const sample = sampled ? selectOrchestraSample(samples, texture ? {...event, layer: 'strings', instrument: event.instrument || 'violin'} : event, p.dynamics) : null;
      if (sampled && !sample) return false;
      const parts = [], sources = [], modulation = [];
      const add = node => { parts.push(node); return node; };
      const env = add(context.createGain()); env.gain.value = 0;
      const pan = add(context.createStereoPanner()); pan.pan.value = event.layer === 'bass' ? 0 : Math.max(-.85, Math.min(.85, event.pan || 0));
      env.connect(pan); pan.connect(layers[event.layer].input);
      const duration = event.duration, end = when + duration;
      const peak = Math.max(0, Math.min(.5, event.velocity || 0));
      const swell = limit(event.swell ?? .4), dynamics = p.dynamics;
      const frequency = midiFrequency(Number.isFinite(event.midi) ? Math.max(0, Math.min(127, event.midi)) : 36);
      const drift = limit(p.drift), richness = limit(p.texture);
      if (event.layer === 'synth' || event.layer === 'melody') {
        const initialPan = pan.pan.value;
        pan.pan.setValueAtTime(initialPan, when);
        pan.pan.linearRampToValueAtTime(-initialPan * (.5 + .4 * drift), when + duration * .62);
        pan.pan.linearRampToValueAtTime(initialPan * .35, end);
      }
      const oscillator = (wave, pitch, gain, detune = 0, destination = env) => {
        const source = context.createOscillator();
        if (typeof wave === 'string') source.type = wave; else source.setPeriodicWave(wave);
        source.frequency.setValueAtTime(pitch, when); source.detune.value = detune;
        const level = add(context.createGain()); level.gain.value = gain;
        source.connect(level); level.connect(destination); sources.push(source);
        if (layers[event.layer].vibrato) {
          layers[event.layer].vibrato.connect(source.detune); modulation.push(source.detune);
        }
        return source;
      };
      const noiseSource = (type, frequency, gain, q = .7) => {
        const source = context.createBufferSource(); source.buffer = noise; source.loop = true;
        const filter = add(context.createBiquadFilter()); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
        const level = add(context.createGain()); level.gain.value = gain;
        source.connect(filter); filter.connect(level); level.connect(env); sources.push(source);
        return {source, filter, level};
      };
      const envelope = (attack, sustain, release, swelling = false) => {
        attack = Math.min(attack, duration * .25); release = Math.min(release, duration * .4);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(peak * (swelling ? .64 : 1), when + attack);
        if (swelling) env.gain.linearRampToValueAtTime(peak, when + duration * (.42 + .10 * swell));
        env.gain.linearRampToValueAtTime(peak * sustain, Math.max(when + attack, end - release));
        env.gain.linearRampToValueAtTime(0, end);
      };
      switch (event.layer) {
        case 'strings':
        case 'brass': {
          const source = context.createBufferSource();
          source.buffer = sample.buffer;
          source.playbackRate.setValueAtTime(sample.playbackRate, when);
          source.loop = true; source.loopStart = sample.loopStart; source.loopEnd = sample.loopEnd;
          const balance = add(context.createGain());
          balance.gain.value = sample.gain * (event.layer === 'strings' ? 1.8 : 1.6);
          source.connect(balance); balance.connect(env); sources.push(source);
          // Preserve the recorded bow/breath attack. The prepared crossfaded
          // sustain loop then supports long, independently overlapping swells.
          envelope(event.layer === 'strings' ? .32 + .32 * (1 - dynamics) : .22 + .30 * (1 - dynamics), .72, Math.min(1.8, duration * .25), true);
          break;
        }
        case 'synth': {
          const color = add(context.createBiquadFilter()); color.type = 'lowpass'; color.Q.value = 1.1 + 1.7 * richness;
          color.frequency.setValueAtTime(frequency * (2.1 + 1.5 * p.brightness), when);
          color.frequency.exponentialRampToValueAtTime(frequency * (5.5 + 4 * richness), when + duration * .57);
          color.frequency.exponentialRampToValueAtTime(frequency * (2.8 + p.brightness), end);
          color.connect(env);
          const left = oscillator(waves.synth, frequency, .33, -8 - 5 * drift, color);
          const right = oscillator(waves.synth, frequency, .30, 7 + 5 * drift, color);
          oscillator('sine', frequency, .25, 0);
          const index = add(context.createGain()); index.gain.value = 0; index.connect(left.frequency);
          index.gain.setValueAtTime(frequency * .012, when);
          index.gain.linearRampToValueAtTime(frequency * (.06 + .15 * richness), when + duration * .55);
          index.gain.linearRampToValueAtTime(frequency * .015, end);
          oscillator('sine', frequency * 1.41421356, 1, 0, index);
          right.detune.setValueAtTime(7 + 5 * drift, when);
          right.detune.linearRampToValueAtTime(-3 - 9 * drift, end);
          envelope(.8 + .5 * (1 - p.energy), .72, 1.45, true);
          break;
        }
        case 'bass': {
          oscillator('sine', frequency, .56);
          oscillator(waves.bass, frequency * 2, .32);
          oscillator('triangle', frequency, .12, -.6);
          envelope(event.kind === 'pulse' ? .012 : .045, .68, .16);
          break;
        }
        case 'melody': {
          if (texture) {
            const source = context.createBufferSource();
            const scan = limit(event.scan ?? .5), reverse = event.kind === 'reverse';
            source.buffer = reverse ? reverseSustain(sample) : sample.buffer;
            source.playbackRate.setValueAtTime(sample.playbackRate, when);
            source.detune.setValueAtTime((scan - .5) * 22 * drift, when);
            source.detune.linearRampToValueAtTime((.5 - scan) * 16 * drift, end);
            source.loop = true;
            source.loopStart = reverse ? 0 : sample.loopStart;
            source.loopEnd = reverse ? source.buffer.duration : sample.loopEnd;
            const offset = reverse ? scan * source.buffer.duration : sample.loopStart + scan * (sample.loopEnd - sample.loopStart);
            source._offset = offset;
            const color = add(context.createBiquadFilter()); color.type = 'bandpass'; color.Q.value = reverse ? .65 : 1.05;
            color.frequency.setValueAtTime(frequency * (reverse ? 2.8 : 1.6 + 3.2 * scan), when);
            color.frequency.exponentialRampToValueAtTime(frequency * (1.4 + 2 * richness), end);
            const balance = add(context.createGain()); balance.gain.value = sample.gain * (reverse ? 5.3 : 6.6);
            source.connect(color); color.connect(balance); balance.connect(env); sources.push(source);
            // A windowed recording fragment, or a reversed sustain recording
            // with a slow inward swell and a brief disappearance.
            env.gain.setValueAtTime(0, when);
            if (reverse) {
              env.gain.linearRampToValueAtTime(peak * .12, when + duration * .32);
              env.gain.linearRampToValueAtTime(peak, end - Math.min(.45, duration * .15));
            } else {
              env.gain.linearRampToValueAtTime(peak * .5, when + duration * .20);
              env.gain.linearRampToValueAtTime(peak, when + duration * .46);
              env.gain.linearRampToValueAtTime(peak * .5, when + duration * .73);
            }
            env.gain.linearRampToValueAtTime(0, end);
            break;
          }
          if (event.kind === 'spark') {
            const carrier = oscillator('sine', frequency, .90);
            const index = add(context.createGain()); index.gain.value = 0; index.connect(carrier.frequency);
            index.gain.setValueAtTime(frequency * (.14 + .32 * richness), when);
            index.gain.exponentialRampToValueAtTime(frequency * .009, end);
            oscillator('sine', frequency * (1.41421356 + .23 * limit(event.scan ?? .5)), 1, 0, index);
            oscillator('sine', frequency * 2.003, .15);
            envelope(.11 + .20 * (1 - p.energy), .23, duration * .45);
            break;
          }
          oscillator(waves.melody, frequency, .68, -1.8);
          oscillator('triangle', frequency, .27, 2.7);
          oscillator('sine', frequency * 2, .05);
          const floating = event.kind === 'legato' || event.kind === 'texture';
          envelope(floating ? .8 + .8 * (1 - dynamics) : .055 + .09 * (1 - dynamics), .70, floating ? 1.1 : .24, floating);
          break;
        }
        case 'percussion': {
          const cymbal = event.kind === 'cymbal', taiko = event.kind === 'taiko';
          env.gain.setValueAtTime(0, when);
          env.gain.linearRampToValueAtTime(peak, when + (cymbal ? .014 : .004));
          env.gain.exponentialRampToValueAtTime(.0001, end - .008); env.gain.linearRampToValueAtTime(0, end);
          if (cymbal) {
            noiseSource('highpass', 4200, .64, .5);
            const shimmer = noiseSource('bandpass', 7300, .30, .65);
            shimmer.filter.frequency.setValueAtTime(7300, when);
            shimmer.filter.frequency.exponentialRampToValueAtTime(4100, end);
          } else {
            let root = taiko ? 65 : frequency;
            // Timpani follow the chord root; octave folding preserves pitch class.
            if (!taiko) {
              while (root > 120) root /= 2;
              while (root < 52) root *= 2;
            }
            const body = oscillator('sine', root * (taiko ? 1.9 : 1.35), .65);
            body.frequency.exponentialRampToValueAtTime(root, when + Math.min(.10, duration * .3));
            const skin = oscillator('sine', root * 1.54, .22);
            skin.frequency.exponentialRampToValueAtTime(root * 1.46, end);
            const strike = noiseSource('bandpass', taiko ? 780 : 1250, taiko ? .25 : .13, .8);
            strike.level.gain.setValueAtTime(taiko ? .25 : .13, when);
            strike.level.gain.exponentialRampToValueAtTime(.0001, when + Math.min(.10, duration * .35));
          }
          break;
        }
      }
      const voice = {sources, parts, end, modulation, layer: event.layer, sampled, texture, kind: event.kind, instrument: sample?.instrument}; voices.add(voice);
      let ended = 0, cleaned = false;
      const cleanup = () => {
        if (cleaned) return; cleaned = true;
        for (const parameter of modulation) { try { layers[event.layer].vibrato.disconnect(parameter); } catch {} }
        for (const node of [...sources, ...parts]) node.disconnect();
        voices.delete(voice);
      };
      voice.cleanup = cleanup;
      for (const source of sources) {
        source.onended = () => { if (++ended === sources.length) cleanup(); };
        if (source._offset !== undefined) source.start(when, source._offset);
        else source.start(when);
        source.stop(end + .01);
      }
      return true;
    },
    stopVoices(now) {
      for (const voice of [...voices]) {
        for (const source of voice.sources) { try { source.stop(now); } catch {} }
        voice.cleanup();
      }
    },
    disconnect() {
      analysis?.reset();
      this.stopVoices(context.currentTime);
      for (const source of continuousSources) { try { source.stop(context.currentTime); } catch {} }
      for (const node of nodes) node.disconnect();
    },
  };
}

export class EmotionMusicEngine {
  constructor({onChange = () => {}, sampleLoader = loadOrchestraSamples} = {}) {
    this._onChange = onChange;
    this._sampleLoader = sampleLoader;
    this._context = null; this._graph = null; this._timer = null;
    this._target = musicParameters(null); this._active = this._target;
    this._volume = .55; this._playing = false; this._disposed = false;
    this._hasPlayed = false;
    this._emptyVisualFrame = createVisualFrame();
    this._operation = 0; this._plan = []; this._cursor = 0;
    this._plannedBar = -1; this._origin = 0; this._reportedBar = -1;
    this._samples = null; this._sampleLoading = null; this._sampleStatus = 'unloaded';
    this._sampleProgress = {loaded: 0, total: 0}; this._sampleError = '';
  }
  _emit() { try { this._onChange(this.getStatus()); } catch (error) { console.error('Music UI callback:', error); } }
  _createContext() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error('此浏览器不支持 Web Audio，请用新版 Chrome 或 Safari 打开。');
    const context = new AudioContextClass({latencyHint: 'interactive'});
    this._context = context;
    this._graph = makeGraph(context, this._target, this._volume);
    context.onstatechange = () => {
      if (context.state !== 'running') { clearInterval(this._timer); this._timer = null; this._graph?.analysis?.reset(); }
      if (context.state === 'running' && this._playing && !this._timer) this._beginTimer();
      this._emit();
    };
  }
  async _loadSamples() {
    if (this._samples) return this._samples;
    if (this._sampleLoading) return this._sampleLoading;
    this._sampleStatus = 'loading'; this._sampleError = ''; this._emit();
    const context = this._context;
    this._sampleLoading = this._sampleLoader(context, {
      onProgress: progress => {
        if (this._disposed || context !== this._context) return;
        this._sampleProgress = progress; this._emit();
      },
    }).then(bank => {
      if (!this._disposed && context === this._context) {
        this._samples = bank; this._graph.setSamples(bank); this._sampleStatus = 'ready'; this._emit();
      }
      return bank;
    }).catch(error => {
      if (!this._disposed && context === this._context) {
        this._sampleStatus = 'error'; this._sampleError = error?.message || '管弦采样加载失败，请重试。'; this._emit();
      }
      throw error;
    }).finally(() => { this._sampleLoading = null; });
    return this._sampleLoading;
  }
  async start() {
    if (this._disposed) throw new Error('音乐引擎已经关闭，请刷新页面。');
    if (!this._context) this._createContext();
    const operation = ++this._operation;
    // resume is invoked before the first await, preserving the user gesture.
    await this._context.resume();
    if (operation !== this._operation || this._disposed) return this.getStatus();
    if (this._context.state !== 'running') throw new Error('浏览器尚未允许播放声音，请再次点击开始音乐。');
    try { await this._loadSamples(); }
    catch (error) {
      if (operation !== this._operation || this._disposed) return this.getStatus();
      this._playing = false;
      this._graph.stopVoices(this._context.currentTime);
      await this._context.suspend();
      // A newer click owns playback if it arrived while suspension completed.
      if (operation !== this._operation && this._playing && this._context.state === 'suspended') await this._context.resume();
      if (operation !== this._operation || this._disposed) return this.getStatus();
      throw error;
    }
    if (operation !== this._operation || this._disposed) return this.getStatus();
    if (this._context.state !== 'running') throw new Error('播放已暂停，请再次点击开启声音。');
    if (!this._playing) {
      // Rebuilding after a pause discards frozen delay/convolution tails. A new
      // entrance cannot replay sound left inside the old suspended graph.
      if (this._hasPlayed) {
        this._graph.disconnect();
        this._graph = makeGraph(this._context, this._target, this._volume, false, this._samples);
      } else this._graph.stopVoices(this._context.currentTime);
      this._origin = this._context.currentTime + .06;
      this._plannedBar = -1; this._reportedBar = -1; this._plan = []; this._cursor = 0;
    }
    this._playing = true; this._hasPlayed = true;
    smooth(this._graph.master.gain, this._volume * OUTPUT_GAIN, this._context.currentTime, .12);
    this._beginTimer(); this._emit();
    return this.getStatus();
  }
  async pause() {
    const operation = ++this._operation;
    this._playing = false;
    this._graph?.analysis?.reset();
    clearInterval(this._timer); this._timer = null;
    const context = this._context;
    if (!context || this._disposed) return this.getStatus();
    smooth(this._graph.master.gain, 0, context.currentTime, .025);
    this._emit();
    await new Promise(resolve => setTimeout(resolve, 130));
    if (operation !== this._operation || this._disposed) return this.getStatus();
    this._graph.stopVoices(context.currentTime);
    await context.suspend();
    if (operation !== this._operation && this._playing && context.state === 'suspended') await context.resume();
    this._emit();
    return this.getStatus();
  }
  setTarget(parameters) {
    if (this._disposed) return;
    const target = sanitizeParameters(parameters);
    if (JSON.stringify(target) === JSON.stringify(this._target)) return;
    this._target = target;
    if (this._graph) this._graph.update(target, this._context.currentTime);
    this._emit();
  }
  setVolume(value) {
    const volume = limit(value);
    if (volume === this._volume || this._disposed) return;
    this._volume = volume;
    if (!volume) this._graph?.analysis?.reset(this._playing && this._context?.state === 'running');
    if (this._graph && this._playing) smooth(this._graph.master.gain, volume * OUTPUT_GAIN, this._context.currentTime, .12);
    this._emit();
  }
  _beginTimer() {
    clearInterval(this._timer);
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }
  _planBar(bar) {
    this._plannedBar = bar; this._active = {...this._target};
    this._plan = planBar(bar, this._active); this._cursor = 0;
  }
  _tick() {
    if (!this._playing || this._context?.state !== 'running') return;
    const now = this._context.currentTime;
    const currentBar = Math.max(0, Math.floor((now - this._origin) / BAR_SECONDS));
    if (this._plannedBar < currentBar) this._planBar(currentBar);
    // Process at most current + next bar; late timers skip past events entirely.
    for (let pass = 0; pass < 2; pass++) {
      const start = this._origin + this._plannedBar * BAR_SECONDS;
      while (this._cursor < this._plan.length) {
        const event = this._plan[this._cursor], when = start + event.offset;
        if (when > now + LOOKAHEAD) break;
        this._cursor++;
        if (when >= now + .005) this._graph.note(event, when, this._active);
      }
      if (this._cursor === this._plan.length && start + BAR_SECONDS <= now + LOOKAHEAD) this._planBar(this._plannedBar + 1);
      else break;
    }
    if (currentBar !== this._reportedBar) { this._reportedBar = currentBar; this._emit(); }
  }
  // The returned frame is reused. Copy it only when retaining a measurement.
  getVisualAnalysis() {
    const playing = !this._disposed && this._playing && this._context?.state === 'running';
    if (!playing || !this._volume) {
      return this._graph?.analysis?.reset(playing) || clearVisualFrame(this._emptyVisualFrame, playing);
    }
    return this._graph?.analysis?.read() || clearVisualFrame(this._emptyVisualFrame, playing);
  }
  getStatus() {
    const contextState = this._disposed ? 'closed' : this._context?.state || 'not-started';
    return {
      playing: this._playing && contextState === 'running', contextState, bpm: MUSIC_BPM,
      bar: this._reportedBar < 0 ? 0 : this._reportedBar + 1,
      volume: this._volume, levels: Object.fromEntries(MUSIC_LAYERS.map(layer => [layer, this._target[layer]])),
      parameters: {...this._target}, activeMode: this._active.mode,
      activeVoices: this._graph?.voices.size || 0,
      sampleStatus: this._sampleStatus, sampleProgress: {...this._sampleProgress}, sampleError: this._sampleError,
      sampleLibrary: this._samples?.library || 'VSCO 2 CE', sampleCount: this._samples?.samples.length || 0,
      sampleVoices: this._graph ? [...this._graph.voices].filter(voice => voice.sampled).length : 0,
      textureVoices: this._graph ? [...this._graph.voices].filter(voice => voice.texture).length : 0,
      grainVoices: this._graph ? [...this._graph.voices].filter(voice => voice.kind === 'grain').length : 0,
      reverseVoices: this._graph ? [...this._graph.voices].filter(voice => voice.kind === 'reverse').length : 0,
      sparkVoices: this._graph ? [...this._graph.voices].filter(voice => voice.kind === 'spark').length : 0,
    };
  }
  async dispose() {
    if (this._disposed) return;
    this._disposed = true; this._playing = false; ++this._operation;
    clearInterval(this._timer); this._timer = null;
    if (this._context) this._context.onstatechange = null;
    this._graph?.disconnect();
    if (this._context && this._context.state !== 'closed') await this._context.close();
    this._samples = null;
    this._emit();
  }
}

// Uses the same planner, instruments and output graph as live playback.
export async function renderOffline(parameters, {seconds = 12, sampleRate = 24000, volume = .55} = {}) {
  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('OfflineAudioContext unavailable');
  const duration = Math.max(1, Math.min(45, Number.isFinite(seconds) ? seconds : 12));
  const rate = [24000, 44100, 48000].includes(sampleRate) ? sampleRate : 24000;
  const context = new OfflineContext(2, Math.ceil(duration * rate), rate);
  const target = sanitizeParameters(parameters);
  const samples = await loadOrchestraSamples(context);
  const graph = makeGraph(context, target, limit(volume), true, samples);
  for (let bar = 0; bar * BAR_SECONDS < duration; bar++) {
    for (const event of planBar(bar, target)) {
      const when = .06 + bar * BAR_SECONDS + event.offset;
      if (when < duration) graph.note(event, when, target);
    }
  }
  graph.master.gain.setValueAtTime(limit(volume) * OUTPUT_GAIN, Math.max(0, duration - .25));
  graph.master.gain.linearRampToValueAtTime(0, duration);
  try { return await context.startRendering(); }
  finally { graph.disconnect(); }
}
