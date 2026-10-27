// These are artistic scoring choices, not measurements of inner emotion.
export const MUSIC_BPM = 84;
export const BEAT_SECONDS = 60 / MUSIC_BPM;
export const BAR_SECONDS = 4 * BEAT_SECONDS;
export const MUSIC_LAYERS = ['strings', 'brass', 'synth', 'bass', 'melody', 'percussion'];
export const MUSIC_CHARACTERS = ['joy', 'sorrow', 'rage', 'dread'];
export const EMOTIONS = ['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt'];
const clamp = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
// brightness, activity, harmonic tension, playing strength, ensemble breadth,
// fragment density, timbral movement, spatial diffusion. These are independent
// artistic controls: a restrained mood can still have deep space and motion.
// Sadness keeps a broad string section even though its rhythm is restrained.
const profiles = {
  happiness: [.95, .64, .08, .70, .90, .68, .66, .80], neutral: [.48, .24, .10, .43, .58, .44, .50, .84],
  sadness: [.13, .10, .32, .40, .86, .32, .38, 1], surprise: [.91, .88, .48, .90, .90, .89, .91, .85],
  anger: [.36, .93, .94, .86, .93, .67, .65, .18], fear: [.42, .48, 1, .42, .48, .95, 1, .95],
  disgust: [.28, .48, .73, .64, .70, .75, .77, .74], contempt: [.42, .34, .58, .55, .63, .59, .69, .81],
};
// Independent character weights retain minority emotions in a mixed audience.
// The other four classes have their own combinations; none is discarded.
const characters = {
  happiness: [1, 0, 0, 0], sadness: [0, 1, 0, 0], anger: [0, 0, 1, 0], fear: [0, 0, 0, 1],
  neutral: [.12, .14, .06, .08], surprise: [.50, 0, .12, .42],
  disgust: [0, .08, .30, .50], contempt: [.08, .20, .35, .20],
};
// strings, brass, synth, bass, melody, percussion: orchestration is deliberately
// not a single loudness multiplier. Each character has a different foreground.
const balances = {
  happiness: [.74, .14, .50, .27, .74, .08], sadness: [.92, .035, .30, .34, .15, .015],
  anger: [.31, .88, .81, .68, .17, .46], fear: [.18, .04, .62, .09, .80, .065],
  neutral: [.63, .16, .44, .31, .33, .07], surprise: [.63, .42, .64, .41, .70, .29],
  disgust: [.38, .32, .68, .48, .37, .13], contempt: [.49, .35, .53, .36, .27, .10],
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
    texture: .18, drift: .30, space: .76, joy: 0, sorrow: 0, rage: 0, dread: 0,
    strings: .36, brass: 0, synth: .30, bass: 0, melody: 0, percussion: 0, pad: .36,
    mode: 'suspended', dominant: null, idle: true, diversity: 0,
  };
  const [brightness, energy, tension, dynamics, orchestration, texture, drift, space] = [0, 1, 2, 3, 4, 5, 6, 7].map(index =>
    weights.reduce((total, weight, i) => total + weight * profiles[EMOTIONS[i]][index], 0));
  const diversityValue = clamp(diversity);
  const weighted = table => table[EMOTIONS[0]].map((_, index) =>
    weights.reduce((sum, weight, i) => sum + weight * table[EMOTIONS[i]][index], 0));
  const [strings, brass, synth, bass, melody, percussion] = weighted(balances);
  const character = Object.fromEntries(MUSIC_CHARACTERS.map((key, i) => [key, weighted(characters)[i]]));
  return {
    brightness, energy, tension, dynamics, orchestration,
    texture: clamp(texture + .08 * diversityValue), drift: clamp(drift + .05 * diversityValue), space,
    ...character, strings, brass, synth, bass, melody, percussion, pad: strings,
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
    ...Object.fromEntries(['brightness', 'energy', 'tension', 'dynamics', 'orchestration', 'texture', 'drift', 'space', 'diversity', ...MUSIC_CHARACTERS, ...MUSIC_LAYERS]
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
    if (p[layer] <= 0 || (extra.character && p[extra.character] <= 0)) return;
    events.push({layer, offset: beat * BEAT_SECONDS, midi, duration: seconds,
      velocity, pan, ...extra, ...(extra.character ? {weight: p[extra.character]} : {})});
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

  // A new character can speak in the very next scheduling segment (2.86 s).
  // These are independent weighted strands, not a dominant-emotion switch.
  // The envelope's character gain also follows new distributions mid-note.
  note('strings', .12 + .44 * grain(index, 201), colour([74, 76, 79, 81, 79, 76], index, 9),
    4.1 + .8 * grain(index, 202), (.093 + .043 * p.dynamics) * accent, -.38 + .7 * grain(index, 203),
    {kind: 'halo', character: 'joy', instrument: 'violin', swell: .62});
  note('strings', .15 + .32 * grain(index, 211), colour([57, 53, 50, 50, 53, 50], index, 7),
    6.4 + 1.4 * grain(index, 212), (.10 + .052 * p.dynamics) * accent, -.24,
    {kind: 'lament', character: 'sorrow', instrument: 'cello', swell: .82});
  note('brass', .14 + .64 * grain(index, 221), 50,
    .95 + 1.15 * grain(index, 222), (.12 + .047 * p.dynamics) * accent, -.22,
    {kind: 'pressure', character: 'rage', instrument: index % 3 ? 'trombone' : 'horn', swell: .18});
  note('synth', 1.24 + 1.9 * grain(index, 223), 50, .54 + .91 * grain(index, 224),
    (.078 + .045 * p.dynamics) * accent, .24, {kind: 'pressure', character: 'rage', swell: .15});
  note('melody', .17 + .72 * grain(index, 231), colour([81, 86, 83, 81, 86], index, 5),
    .66 + 1.12 * grain(index, 232), (.085 + .043 * p.dynamics) * accent,
    -.8 + 1.6 * grain(index, 233), {kind: 'whisper', character: 'dread', swell: .3});

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
    const fragmentPitches = [69, 74, 79, colour(field.air, index, 31)];
    const opportunities = 2 + Math.floor(2 * p.texture);
    for (let i = 0; i < opportunities; i++) {
      if (grain(index, 101 + i * 7) > (.55 + .40 * p.texture) * (1 - .66 * p.sorrow - .42 * p.rage - .40 * p.dread)) continue;
      const pick = Math.floor(grain(index, 102 + i * 7) * fragmentPitches.length);
      note('melody', .08 + 3.80 * grain(index, 103 + i * 7), fragmentPitches[pick],
        .38 + .95 * (1 - .55 * p.energy) * grain(index, 104 + i * 7),
        (.043 + .034 * p.dynamics) * (.65 + .35 * p.texture) * accent,
        -.88 + 1.76 * grain(index, 105 + i * 7),
        {kind: 'grain', instrument: 'violin', scan: grain(index, 106 + i * 7), swell: .65});
    }
    // A reverse swell emerges only occasionally, with no synchronised accent
    // from the rest of the orchestra. Its release is handled by the same engine.
    if (index === 1 || grain(index, 141) < .045 + .10 * p.texture + .04 * p.space + .42 * p.dread) {
      note('melody', .10 + 3.65 * grain(index, 142), colour(field.air, index, 19),
        3.4 + 3.2 * p.space * grain(index, 143),
        (.066 + .045 * p.dynamics) * (.65 + .35 * p.texture) * accent * (1 + .65 * p.dread),
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
