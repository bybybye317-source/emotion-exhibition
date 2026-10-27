// Artistic mappings of the complete group distribution, not measurements of
// anyone's internal feelings. Audio values always come from the live output.
export const VISUAL_EMOTIONS = Object.freeze(['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt']);
const finiteUnit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
// Form = horizontal spread, vertical reach, resting tilt, rolled-sheet arc.
// Material = roughness, edge transmission, body light, iridescence. Independent
// form/material coordinates keep emotions distinguishable without relying on hue.
const profiles = {
  happiness: {shape:[1,0,0,0], form:[1.36,.76,-.12,3.92], material:[.18,.92,.19,.62], a:[.12,.48,.93], b:[1.32,.78,.23], speed:1.12},
  neutral:   {shape:[.12,.07,.02,.06], form:[1,1,-.52,5.48], material:[.36,.55,.10,.42], a:[.21,.30,.57], b:[.72,.67,.53], speed:.62},
  sadness:   {shape:[0,1,0,0], form:[.66,1.17,-.10,5.12], material:[.60,.38,.075,.23], a:[.045,.16,.43], b:[.36,.56,.78], speed:.31},
  surprise:  {shape:[.95,0,.46,.04], form:[1.20,.94,-.32,4.30], material:[.16,1,.20,.75], a:[.35,.30,.89], b:[1.15,.88,.59], speed:1.28},
  anger:     {shape:[0,0,1,0], form:[1.16,.70,-.28,5.78], material:[.77,.52,.17,.09], a:[.53,.026,.035], b:[1.3,.32,.08], speed:1.40},
  fear:      {shape:[0,0,0,1], form:[.55,1.03,.22,6.03], material:[.24,.82,.045,.95], a:[.26,.075,.59], b:[.22,.76,.67], speed:.79},
  disgust:   {shape:[.02,.18,.40,.65], form:[.78,.88,.12,5.83], material:[.69,.39,.085,.42], a:[.18,.30,.24], b:[.61,.64,.23], speed:.68},
  contempt:  {shape:[.10,.18,.22,.18], form:[.91,.94,-.72,5.26], material:[.43,.48,.09,.36], a:[.34,.19,.42], b:[.82,.48,.42], speed:.59},
};

export function visualProfile(scores) {
  const values = VISUAL_EMOTIONS.map(key => Number.isFinite(scores?.[key]) ? Math.max(0, scores[key]) : 0);
  const maximum = Math.max(...values);
  const idle = maximum === 0;
  const scaled = idle ? VISUAL_EMOTIONS.map(key => key === 'neutral' ? 1 : 0) : values.map(value => value / maximum);
  const sum = scaled.reduce((total, value) => total + value, 0);
  const weights = scaled.map(value => value / sum);
  const shape = [0,0,0,0], form = [0,0,0,0], material = [0,0,0,0], colorA = [0,0,0], colorB = [0,0,0];
  let speed = 0;
  weights.forEach((weight, i) => {
    const p = profiles[VISUAL_EMOTIONS[i]];
    for (let j = 0; j < 4; j++) { shape[j] += p.shape[j] * weight; form[j] += p.form[j] * weight; material[j] += p.material[j] * weight; }
    for (let j = 0; j < 3; j++) { colorA[j] += p.a[j] * weight; colorB[j] += p.b[j] * weight; }
    speed += p.speed * weight;
  });
  return {shape, form, material, colorA, colorB, speed, idle, dominant: idle ? 'neutral' : VISUAL_EMOTIONS[weights.indexOf(Math.max(...weights))]};
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
    form: Float32Array.from(profile.form), material: Float32Array.from(profile.material),
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
  for (const key of ['shape','form','material','colorA','colorB']) {
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
