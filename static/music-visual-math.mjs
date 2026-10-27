// Artistic mappings of the complete group distribution, not measurements of
// anyone's internal feelings. Audio values always come from the live output.
export const VISUAL_EMOTIONS = Object.freeze(['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt']);
const finiteUnit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const profiles = {
  happiness: {shape:[1,0,0,0], a:[.23,.39,.91], b:[1.15,.72,.36], speed:1.02},
  neutral:   {shape:[.12,.07,.02,.06], a:[.21,.30,.57], b:[.72,.67,.53], speed:.62},
  sadness:   {shape:[0,1,0,0], a:[.10,.24,.56], b:[.32,.65,.83], speed:.45},
  surprise:  {shape:[.95,0,.46,.04], a:[.35,.30,.89], b:[1.15,.88,.59], speed:1.28},
  anger:     {shape:[0,0,1,0], a:[.51,.055,.08], b:[1.2,.29,.12], speed:1.23},
  fear:      {shape:[0,0,0,1], a:[.29,.14,.60], b:[.35,.74,.64], speed:.86},
  disgust:   {shape:[.02,.18,.40,.65], a:[.18,.30,.24], b:[.61,.64,.23], speed:.68},
  contempt:  {shape:[.10,.18,.22,.18], a:[.34,.19,.42], b:[.82,.48,.42], speed:.59},
};

export function visualProfile(scores) {
  const values = VISUAL_EMOTIONS.map(key => Number.isFinite(scores?.[key]) ? Math.max(0, scores[key]) : 0);
  const maximum = Math.max(...values);
  const idle = maximum === 0;
  const scaled = idle ? VISUAL_EMOTIONS.map(key => key === 'neutral' ? 1 : 0) : values.map(value => value / maximum);
  const sum = scaled.reduce((total, value) => total + value, 0);
  const weights = scaled.map(value => value / sum);
  const shape = [0,0,0,0], colorA = [0,0,0], colorB = [0,0,0];
  let speed = 0;
  weights.forEach((weight, i) => {
    const p = profiles[VISUAL_EMOTIONS[i]];
    for (let j = 0; j < 4; j++) shape[j] += p.shape[j] * weight;
    for (let j = 0; j < 3; j++) { colorA[j] += p.a[j] * weight; colorB[j] += p.b[j] * weight; }
    speed += p.speed * weight;
  });
  return {shape, colorA, colorB, speed, idle, dominant: idle ? 'neutral' : VISUAL_EMOTIONS[weights.indexOf(Math.max(...weights))]};
}

export function liveAudioTargets(audio = {}, reducedMotion = false) {
  const rms = finiteUnit(audio?.rms);
  const audible = audio?.playing === true && rms > .00001;
  const amount = reducedMotion ? .22 : 1;
  const gate = audible ? Math.min(1, rms * 120) : 0;
  const band = value => Math.min(1, Math.sqrt(finiteUnit(value)) * 2.3) * gate * amount;
  const layer = value => Math.min(1, Math.sqrt(finiteUnit(value)) * 3.5) * gate * amount;
  return {
    audible,
    drive: audible ? Math.min(1, Math.sqrt(rms) * 2.9) * amount : 0,
    bass: band(audio?.bass), mid: band(audio?.mid), treble: band(audio?.treble), flux: band(audio?.flux),
    strings: layer(audio?.layers?.strings), brass: layer(audio?.layers?.brass),
    melody: layer(audio?.layers?.melody), synth: layer(audio?.layers?.synth),
  };
}

export function createMatterState(profile = visualProfile(null)) {
  return {
    shape: Float32Array.from(profile.shape), colorA: Float32Array.from(profile.colorA), colorB: Float32Array.from(profile.colorB),
    speed: profile.speed, phase: 7.5, drive: 0, bass: 0, mid: 0, treble: 0, flux: 0,
    strings: 0, brass: 0, melody: 0, synth: 0,
  };
}

const audioKeys = ['drive','bass','mid','treble','flux','strings','brass','melody','synth'];
// Mutates one state object so rendering does not allocate per vertex or frame.
export function advanceMatterState(state, profile, audio, delta, reducedMotion = false, idleMusic = false) {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(.1, delta)) : 0;
  const target = liveAudioTargets(audio, reducedMotion);
  const moodAlpha = 1 - Math.exp(-dt / 1.6);
  for (const key of ['shape','colorA','colorB']) {
    for (let i = 0; i < state[key].length; i++) state[key][i] += (profile[key][i] - state[key][i]) * moodAlpha;
  }
  state.speed += (profile.speed - state.speed) * moodAlpha;
  for (const key of audioKeys) {
    const tau = target[key] > state[key] ? .065 : target.audible ? .24 : .09;
    state[key] += (target[key] - state[key]) * (1 - Math.exp(-dt / tau));
    if (state[key] < .0001) state[key] = 0;
  }
  // No wall-clock pulse: a suspended context or actual zero output freezes phase.
  if (target.audible) state.phase = (state.phase + dt * target.drive * state.speed * (idleMusic ? .55 : 1)) % 10000;
  return state;
}
