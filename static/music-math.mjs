// These are artistic scoring choices, not measurements of inner emotion.
export const MUSIC_BPM = 84;
export const BEAT_SECONDS = 60 / MUSIC_BPM;
export const BAR_SECONDS = 4 * BEAT_SECONDS;
export const MUSIC_LAYERS = ['strings', 'brass', 'synth', 'bass', 'melody', 'percussion'];
export const EMOTIONS = ['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt'];
const clamp = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
// brightness, activity, harmonic tension, playing strength, ensemble breadth,
// fragment density, timbral movement, spatial diffusion. These are independent
// artistic controls: a restrained mood can still have deep space and motion.
// Sadness keeps a broad string section even though its rhythm is restrained.
const profiles = {
  happiness: [.91, .74, .14, .78, .90, .68, .60, .78], neutral: [.48, .24, .10, .43, .58, .44, .50, .84],
  sadness: [.26, .18, .29, .50, .82, .48, .59, .94], surprise: [.91, .88, .48, .90, .90, .89, .91, .85],
  anger: [.40, .94, .88, .97, .93, .84, .72, .61], fear: [.32, .66, .93, .63, .72, .92, .94, .89],
  disgust: [.28, .48, .73, .64, .70, .75, .77, .74], contempt: [.42, .34, .58, .55, .63, .59, .69, .81],
};
function distribution(scores) {
  const values = EMOTIONS.map(key => Number.isFinite(scores?.[key]) ? Math.max(0, scores[key]) : 0);
  // Scaling before summing avoids overflow on otherwise valid large inputs.
  const max = Math.max(...values);
  if (!max) return null;
  const sum = values.reduce((total, value) => total + value / max, 0);
  return values.map(value => value / max / sum);
}

export function musicParameters(scores, {idle = false, diversity = 0} = {}) {
  const weights = distribution(scores);
  if (idle || !weights) return {
    brightness: .34, energy: .07, tension: .08, dynamics: .25, orchestration: .36,
    texture: .18, drift: .30, space: .76,
    strings: .36, brass: 0, synth: .30, bass: 0, melody: 0, percussion: 0, pad: .36,
    mode: 'suspended', dominant: null, idle: true, diversity: 0,
  };
  const [brightness, energy, tension, dynamics, orchestration, texture, drift, space] = [0, 1, 2, 3, 4, 5, 6, 7].map(index =>
    weights.reduce((total, weight, i) => total + weight * profiles[EMOTIONS[i]][index], 0));
  const diversityValue = clamp(diversity);
  const strings = clamp(.56 + .28 * orchestration + .12 * (1 - energy));
  return {
    brightness, energy, tension, dynamics, orchestration,
    texture: clamp(texture + .08 * diversityValue), drift: clamp(drift + .05 * diversityValue), space,
    strings, pad: strings,
    brass: clamp((.12 + .63 * dynamics) * (.35 + .65 * energy) * (1 - .25 * tension)),
    synth: clamp(.33 + .33 * tension + .16 * orchestration),
    bass: clamp(.30 + .38 * dynamics + .16 * energy),
    melody: clamp(.16 + .17 * brightness + .10 * (1 - tension) + .06 * diversityValue),
    percussion: clamp((energy - .15) * (.32 + .15 * dynamics)),
    mode: tension > .52 ? 'suspended' : weights[0] >= weights[2] ? 'major' : 'minor',
    dominant: EMOTIONS[weights.indexOf(Math.max(...weights))],
    idle: false, diversity: diversityValue,
  };
}

// Mean Jensen-Shannon divergence distinguishes disagreement between people
// from one similarly uncertain prediction repeated for every participant.
export function groupDiversity(participants) {
  if (!Array.isArray(participants)) return 0;
  const distributions = participants.map(person => distribution(person?.scores ?? person)).filter(Boolean);
  if (distributions.length < 2) return 0;
  const mean = EMOTIONS.map((_, i) => distributions.reduce((sum, p) => sum + p[i], 0) / distributions.length);
  const entropy = values => -values.reduce((sum, value) => sum + (value > 0 ? value * Math.log(value) : 0), 0);
  const divergence = entropy(mean) - distributions.reduce((sum, p) => sum + entropy(p), 0) / distributions.length;
  return clamp(divergence / Math.log(Math.min(EMOTIONS.length, distributions.length)));
}

export function sanitizeParameters(parameters = {}) {
  const source = parameters && typeof parameters === 'object' ? parameters : {};
  const fallback = musicParameters(null);
  const result = {
    ...Object.fromEntries(['brightness', 'energy', 'tension', 'dynamics', 'orchestration', 'texture', 'drift', 'space', 'diversity', ...MUSIC_LAYERS]
      .map(key => [key, clamp(source[key], fallback[key])])),
    idle: Boolean(source.idle),
    mode: ['major', 'minor', 'suspended'].includes(source.mode) ? source.mode : fallback.mode,
    dominant: EMOTIONS.includes(source.dominant) ? source.dominant : null,
  };
  // Retain the old name only as a compatibility alias; the score uses strings.
  result.pad = result.strings;
  return result;
}

export function midiFrequency(midi) { return 440 * 2 ** ((midi - 69) / 12); }

// A fixed D/A axis holds the whole installation together. Emotion changes the
// upper modal colours, register, breadth and pressure, never a bass-root cycle.
// All colours belong to the same white-note collection, so slowly fading old
// strands can coexist with a new emotion without an unrelated key change.
const colours = {
  major: {
    inner: [64, 64, 67, 64, 62, 64], upper: [71, 72, 71, 69, 71, 74, 71],
    air: [79, 81, 79, 76, 79, 81], line: [76, 79, 81, 79, 76, 74, 76],
  },
  minor: {
    inner: [65, 64, 65, 67, 65, 64], upper: [72, 69, 72, 74, 72, 69],
    air: [77, 76, 77, 79, 77, 76], line: [77, 76, 74, 72, 74, 76],
  },
  suspended: {
    inner: [64, 65, 64, 62, 64, 65], upper: [71, 72, 71, 69, 71, 74],
    air: [77, 76, 77, 79, 77, 76], line: [76, 77, 76, 74, 71, 74],
  },
};
// Deterministic, aperiodic-looking spacing permits reproducible offline renders.
// It is only a timing variation, not a generator of random scales or melodies.
function grain(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
function colour(path, index, rate, phase = 0) {
  return path[Math.floor(index / rate + phase) % path.length];
}

// Each scheduling bar contributes independent long strands to a continuing
// texture. A bar is not a harmonic unit: most voices are still sustaining when
// the next one begins. Different entry periods and much slower pitch changes
// avoid coordinated chord attacks, an eight-bar theme, and audible cadences.
// Event duration includes its release; sample playback may loop within it.
export function planBar(bar, parameters) {
  const p = sanitizeParameters(parameters);
  const index = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.isFinite(bar) ? bar : 0)));
  const field = colours[p.mode];
  const breath = p.idle ? .35 : .58 + .17 * Math.sin(index * .137) + .12 * Math.sin(index * .071 + 2.4);
  const accent = .70 + .30 * breath;
  const events = [];
  const note = (layer, beat, midi, seconds, velocity, pan = 0, extra = {}) => {
    if (p[layer] <= 0) return;
    events.push({layer, offset: beat * BEAT_SECONDS, midi, duration: seconds,
      velocity, pan, ...extra});
  };
  const enters = (period, phase, seed = false) => index % period === phase || (seed && index === 0);
  const strings = [
    {midi: 50, instrument: 'cello', period: 3, phase: 0, beat: .12, seconds: 10.9, pan: -.35},
    {midi: 57, instrument: 'cello', period: 4, phase: 1, beat: .77, seconds: 11.9, pan: .31},
    {midi: colour(field.inner, index, 17), instrument: 'violin', period: 3, phase: 1, beat: 1.38, seconds: 10.6, pan: -.65},
    {midi: colour([74, 74, 76, 74, 71, 74], index, 19), instrument: 'violin', period: 4, phase: 2, beat: 2.05, seconds: 11.8, pan: .64},
    {midi: colour(field.upper, index, 11), instrument: 'violin', period: 5, phase: 2, beat: 2.70, seconds: 11.7, pan: -.20},
    {midi: colour(field.air, index, 23), instrument: 'violin', period: 7, phase: 4, beat: 3.28, seconds: 11.4, pan: .20},
  ];
  const stringCount = p.idle ? 2 : p.orchestration > .83 ? 6 : p.orchestration > .67 ? 5 : 4;
  strings.slice(0, stringCount).forEach((voice, i) => {
    if (!enters(voice.period, voice.phase, true)) return;
    const beat = voice.beat + .11 * grain(index, i + 1);
    note('strings', beat, voice.midi, voice.seconds,
      (.066 + .047 * p.dynamics) * accent * (i > 3 ? .72 : 1), voice.pan,
      {instrument: voice.instrument, kind: 'legato', swell: .45 + .40 * breath});
  });
  if (enters(3, 0, true)) note('synth', .41 + .19 * grain(index, 21), 62, 11.6,
    (.040 + .024 * p.tension + .017 * p.dynamics) * accent, -.42, {kind: 'legato', swell: .6 * breath});
  if (enters(5, 3, true)) note('synth', 2.45 + .17 * grain(index, 22), 69, 11.9,
    (.033 + .019 * p.tension + .012 * p.dynamics) * accent, .42, {kind: 'legato', swell: .7 * breath});
  if (p.idle) return events.sort((a, b) => a.offset - b.offset);

  // One held bass pedal, with neither a root progression nor a bar-wise attack.
  if (enters(4, 0)) note('bass', .28 + .17 * grain(index, 31), 38, 11.9,
    (.090 + .063 * p.dynamics) * accent, 0, {kind: 'legato', swell: .45 * breath});

  // Brass opens behind the strings in occasional overlapping swells. Horns
  // remain within the sampled range; trombone adds weight without cadences.
  const brassPeriod = p.energy > .75 ? 5 : p.energy > .45 ? 7 : 11;
  if (p.orchestration > .45 && enters(brassPeriod, 2)) {
    note('brass', .63 + .45 * grain(index, 41), index % 2 ? 57 : 62, 7.8 + 1.1 * p.orchestration,
      (.071 + .068 * p.dynamics) * accent, -.30,
      {instrument: 'horn', kind: 'legato', swell: .50 + .38 * breath});
  }
  if (p.orchestration > .75 && enters(p.energy > .75 ? 7 : 13, 4)) {
    note('brass', 2.28 + .40 * grain(index, 42), p.energy > .80 ? 50 : 57, 8.3,
      (.055 + .061 * p.dynamics) * accent, .30,
      {instrument: 'trombone', kind: 'legato', swell: .52 + .35 * breath});
  }

  // The old four-note theme becomes one quiet, long upper strand. Pitch changes
  // less often than entries and never outline a chord or announce a cadence.
  if (enters(5, 2)) note('melody', 1.19 + .50 * grain(index, 51), colour(field.line, index, 13),
    7.2 + 1.5 * (1 - p.energy), (.065 + .043 * p.dynamics) * accent, -.08,
    {kind: 'texture', swell: .48 + .25 * breath});
  if (p.diversity > .55 && p.orchestration > .75 && enters(11, 6)) {
    note('synth', 2.71, colour(field.upper, index, 29) + 12, 10.7,
      (.032 + .012 * p.dynamics) * accent, .24, {kind: 'legato', swell: .5 * breath});
  }

  // The microscopic layer is made from short windows of real violin recordings.
  // Irregular positions and changing scan regions give motion within a fixed
  // pitch field; they never spell out an arpeggio or a sequence of chord roots.
  // Velocity remains small so that the orchestra can carry the large scale.
  if (p.texture > 0) {
    const fragmentPitches = [62, 69, 74, colour(field.air, index, 31)];
    const opportunities = 2 + Math.floor(2 * p.texture);
    for (let i = 0; i < opportunities; i++) {
      if (grain(index, 101 + i * 7) > .55 + .40 * p.texture) continue;
      const pick = Math.floor(grain(index, 102 + i * 7) * fragmentPitches.length);
      note('melody', .08 + 3.80 * grain(index, 103 + i * 7), fragmentPitches[pick],
        .38 + .95 * (1 - .55 * p.energy) * grain(index, 104 + i * 7),
        (.043 + .034 * p.dynamics) * (.65 + .35 * p.texture) * accent,
        -.88 + 1.76 * grain(index, 105 + i * 7),
        {kind: 'grain', instrument: 'violin', scan: grain(index, 106 + i * 7), swell: .65});
    }
    // A reverse swell emerges only occasionally, with no synchronised accent
    // from the rest of the orchestra. Its release is handled by the same engine.
    if (index === 1 || grain(index, 141) < .045 + .10 * p.texture + .04 * p.space) {
      note('melody', .10 + 3.65 * grain(index, 142), colour(field.upper, index, 19),
        3.4 + 3.2 * p.space * grain(index, 143),
        (.066 + .045 * p.dynamics) * (.65 + .35 * p.texture) * accent,
        -.75 + 1.50 * grain(index, 144),
        {kind: 'reverse', instrument: 'violin', scan: grain(index, 145), swell: .90});
    }
    // Sparse inharmonic colour is produced inside the synth voice, not by adding
    // chromatic chord changes. Even the most active mood has at most one spark.
    if (grain(index, 151) < .12 + .22 * p.texture + .20 * p.tension) {
      note('melody', .15 + 3.60 * grain(index, 152), colour(field.line, index, 17),
        1.1 + 2.7 * grain(index, 153), (.034 + .030 * p.dynamics) * accent,
        -.90 + 1.80 * grain(index, 154),
        {kind: 'spark', scan: grain(index, 155), swell: .40});
    }
  }

  // Arousal adds a few irregular, single-pitch pulses, not a chord arpeggio.
  if (p.energy > .55 && grain(index, 61) < (p.energy - .40) * .50) {
    const beat = .61 + 2.50 * grain(index, 62);
    note('synth', beat, 62, .95, (.035 + .025 * p.dynamics) * accent,
      grain(index, 63) * .5 - .25, {kind: 'pulse', swell: 0});
  }
  if (p.percussion > .055) {
    const hit = (kind, beat, seconds, velocity, pan = 0) => events.push({
      layer: 'percussion', kind, offset: beat * BEAT_SECONDS, duration: seconds,
      velocity, pan, ...(kind === 'timpani' ? {midi: 50} : {}),
    });
    if (grain(index, 71) < .08 + p.energy * .28) hit('timpani', .47 + 2.9 * grain(index, 72), 1.7,
      (.090 + .095 * p.dynamics) * accent, -.12);
    if (p.energy > .55 && grain(index, 73) < (p.energy - .40) * .42) hit('taiko', .72 + 2.6 * grain(index, 74), .80,
      (.076 + .074 * p.dynamics) * accent, .18);
    if (enters(11, 5)) hit('cymbal', 1.87, 3.6, (.055 + .042 * p.dynamics) * accent, .24);
  }
  return events.sort((a, b) => a.offset - b.offset);
}

export function eventsInWindow(events, barStart, now, horizon = .16) {
  if (![barStart, now, horizon].every(Number.isFinite) || horizon < 0) return [];
  // Old notes are discarded after an inactive tab; never replay a missed backlog.
  return events.filter(event => barStart + event.offset >= now + .005 && barStart + event.offset <= now + horizon);
}
