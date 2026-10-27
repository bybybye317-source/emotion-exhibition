import {CHANNELS} from './scent-math.mjs?v=20261028-flow';

const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const MAX_FILL = .72;
const PIPE_ARRIVAL = .18;
const DOSING_END = .6;
const BLEND_START = .55;
const EMPTY_COLOR = '#aab7be';

function ingredientsFor(recipe) {
  const values = CHANNELS.map(({key}) => Number.isFinite(recipe?.percentages?.[key])
    ? Math.max(0, recipe.percentages[key]) : 0);
  const max = Math.max(...values);
  const scaled = max ? values.map(value => value / max) : values;
  const sum = scaled.reduce((total, value) => total + value, 0);
  return Object.fromEntries(CHANNELS.map(({key, color}, index) => [key,
    {weight: sum ? scaled[index] / sum : 0, color}]));
}

function mixtureColor(ingredients) {
  if (!Object.values(ingredients).some(item => item.weight > 0)) return EMPTY_COLOR;
  // Weighted material colors are an artistic visualization, not a physical optical model.
  // The warm/cool pigment in the palette stays visible without adding white to the blend.
  const rgb = [1, 3, 5].map(offset => Math.round(Object.values(ingredients).reduce((sum, item) =>
    sum + item.weight * parseInt(item.color.slice(offset, offset + 2), 16), 0)));
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Derive visual liquid from the simulator's current batch only. `targetRecipe`,
 * `smoothedRecipe` and the UI's preparation `recipe` never feed this function.
 * Fill/blend are geometric ratios; release/purge are visual intensity envelopes.
 * This does not alter the simulator's virtual output or control any hardware.
 */
export function deriveFluidState(snapshot = {}) {
  const ingredients = ingredientsFor(snapshot?.activeRecipe);
  const state = {stage: 'idle', fill: 0, blend: 0, inflow: 0, front: 0,
    release: 0, purge: 0, color: mixtureColor(ingredients), ingredients};
  if (snapshot?.enabled !== true) return state;
  const progress = clamp(snapshot.progress);

  // Clear air has its own gate and never creates colored liquid or scent mist.
  if (snapshot.phase === 'purging') {
    if (!(Number.isFinite(snapshot.purge) && snapshot.purge > 0)) return state;
    return {...state, stage: 'purging', purge: clamp(snapshot.purge)
      * smooth(progress / .12) * smooth((1 - progress) / .16)};
  }

  if (!Object.values(ingredients).some(item => item.weight > 0)) return state;
  if (snapshot.phase === 'mixing') {
    return {...state,
      stage: progress < DOSING_END ? 'dosing' : 'blending',
      front: smooth(progress / PIPE_ARRIVAL),
      inflow: smooth(progress / .08) * smooth((DOSING_END - progress) / .08),
      fill: MAX_FILL * smooth((progress - PIPE_ARRIVAL) / (DOSING_END - PIPE_ARRIVAL)),
      // Keep distinct material streams visible for most of the dosing interval.
      blend: smooth((progress - BLEND_START) / (1 - BLEND_START)),
    };
  }

  if (snapshot.phase === 'releasing') {
    // Only real, positive virtual outputs for this batch can light the outlet.
    const output = CHANNELS.reduce((sum, {key}) => sum + (ingredients[key].weight > 0
      && Number.isFinite(snapshot.outputs?.[key]) ? clamp(snapshot.outputs[key] / 100) : 0), 0);
    if (!(output > 0)) return state;
    return {...state, stage: 'releasing',
      fill: MAX_FILL * (1 - smooth(progress)),
      // A finished blend never separates again. Reset only once the chamber is empty.
      blend: progress < 1 ? 1 : 0,
      release: clamp(output) * smooth(progress / .14) * smooth((1 - progress) / .22),
    };
  }
  return state;
}
