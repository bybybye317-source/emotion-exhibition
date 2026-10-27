import {MUSIC_LAYERS} from './music-math.mjs';

const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const bands = [[30, 250], [250, 2000], [2000, 12000]];
const bandNames = ['bass', 'mid', 'treble'];

// Raw sample amplitude, not target gain or scheduled note velocity. Keeping the
// two channels separate avoids losing wide, opposite-phase orchestral material.
export function stereoAmplitude(left, right, output = {}) {
  let power = 0, peak = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = Number.isFinite(left[i]) ? Math.max(-1, Math.min(1, left[i])) : 0;
    const r = Number.isFinite(right[i]) ? Math.max(-1, Math.min(1, right[i])) : 0;
    power += l * l + r * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  output.rms = length ? Math.sqrt(power / (2 * length)) : 0;
  output.peak = peak;
  return output;
}

const amplitudeFromDb = value => !Number.isFinite(value) || value < -120 ? 0 : 10 ** (Math.min(0, value) / 20);

export class SpectrumFeatures {
  constructor(sampleRate, fftSize) {
    this.previousLeft = new Float64Array(fftSize / 2);
    this.previousRight = new Float64Array(fftSize / 2);
    this.bandForBin = new Int8Array(fftSize / 2).fill(-1);
    for (let i = 0; i < this.bandForBin.length; i++) {
      const hz = i * sampleRate / fftSize;
      this.bandForBin[i] = bands.findIndex(([low, high]) => hz >= low && hz < high);
    }
    this.power = new Float64Array(3);
    this.fresh = true;
  }
  reset() {
    this.previousLeft.fill(0); this.previousRight.fill(0); this.fresh = true;
  }
  read(leftDb, rightDb, output) {
    this.power.fill(0);
    let fluxPower = 0;
    for (let i = 0; i < this.bandForBin.length; i++) {
      const left = amplitudeFromDb(leftDb[i]), right = amplitudeFromDb(rightDb[i]);
      const band = this.bandForBin[i];
      if (band >= 0) {
        this.power[band] += (left * left + right * right) * .5;
        const riseLeft = Math.max(0, left - this.previousLeft[i]);
        const riseRight = Math.max(0, right - this.previousRight[i]);
        fluxPower += (riseLeft * riseLeft + riseRight * riseRight) * .5;
      }
      this.previousLeft[i] = left; this.previousRight[i] = right;
    }
    // These are visual strengths, not calibrated band RMS: fixed scaling of the
    // FFT's linear amplitude energy. No auto-gain, random motion, or score data.
    for (let band = 0; band < 3; band++) output[bandNames[band]] = unit(Math.sqrt(this.power[band]) * 2.5);
    output.flux = this.fresh ? 0 : unit(Math.sqrt(fluxPower) * 4);
    this.fresh = false;
    return output;
  }
}

export function createVisualFrame() {
  return {playing: false, rms: 0, peak: 0, bass: 0, mid: 0, treble: 0, flux: 0,
    layers: Object.fromEntries(MUSIC_LAYERS.map(layer => [layer, 0]))};
}

export function clearVisualFrame(frame, playing = false) {
  frame.playing = playing;
  frame.rms = frame.peak = frame.bass = frame.mid = frame.treble = frame.flux = 0;
  for (const layer of MUSIC_LAYERS) frame.layers[layer] = 0;
  return frame;
}

function stereoTap(context, source, fftSize, own) {
  const splitter = own(context.createChannelSplitter(2));
  source.connect(splitter);
  const analysers = [0, 1].map(channel => {
    const analyser = own(context.createAnalyser());
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel);
    // AnalyserNode can observe its input with its output unconnected. This side
    // branch never feeds the destination, so the audible gain and mix are intact.
    return analyser;
  });
  const left = new Float32Array(fftSize), right = new Float32Array(fftSize);
  const leftDb = new Float32Array(fftSize / 2), rightDb = new Float32Array(fftSize / 2);
  return {
    amplitude(output) {
      analysers[0].getFloatTimeDomainData(left); analysers[1].getFloatTimeDomainData(right);
      return stereoAmplitude(left, right, output);
    },
    spectrum(features, output) {
      analysers[0].getFloatFrequencyData(leftDb); analysers[1].getFloatFrequencyData(rightDb);
      return features.read(leftDb, rightDb, output);
    },
  };
}

export function createMusicAnalysis(context, outputNode, layerNodes, own) {
  const frame = createVisualFrame();
  const main = stereoTap(context, outputNode, 2048, own);
  const layerTaps = Object.fromEntries(MUSIC_LAYERS.map(layer => [layer, stereoTap(context, layerNodes[layer], 512, own)]));
  const spectrum = new SpectrumFeatures(context.sampleRate, 2048);
  const layerAmplitude = {rms: 0, peak: 0};
  let lastTime = -1;
  return {
    reset(playing = false) {
      lastTime = -1; spectrum.reset();
      return clearVisualFrame(frame, playing);
    },
    read() {
      // Multiple UI readers in one audio quantum share the same measurements.
      if (context.currentTime === lastTime) return frame;
      lastTime = context.currentTime;
      frame.playing = true;
      main.amplitude(frame);
      if (frame.peak <= 1e-7) {
        spectrum.reset();
        return clearVisualFrame(frame, true);
      }
      main.spectrum(spectrum, frame);
      for (const layer of MUSIC_LAYERS) frame.layers[layer] = layerTaps[layer].amplitude(layerAmplitude).rms;
      return frame;
    },
  };
}
