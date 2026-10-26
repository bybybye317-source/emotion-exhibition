// These are authored exhibition mappings, not validated psychological or perfume formulas.
export const CHANNELS = Object.freeze([
  Object.freeze({key: 'citrus', label: '柑橘', color: '#d9a142'}),
  Object.freeze({key: 'floral', label: '花香', color: '#c27a91'}),
  Object.freeze({key: 'wood', label: '木质', color: '#9a795e'}),
  Object.freeze({key: 'herbal', label: '草本', color: '#6f9b85'}),
]);
export const EMOTIONS = Object.freeze(['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt']);
export const PHASE_DURATIONS = Object.freeze({mixing: 3000, releasing: 6000, purging: 8000, waiting: 5000});
export const SCENT_PROFILES = Object.freeze({
  happiness: Object.freeze([55, 25, 10, 10]),
  neutral: Object.freeze([20, 20, 30, 30]),
  sadness: Object.freeze([10, 25, 45, 20]),
  surprise: Object.freeze([55, 10, 10, 25]),
  anger: Object.freeze([15, 10, 50, 25]),
  fear: Object.freeze([10, 15, 30, 45]),
  disgust: Object.freeze([10, 5, 35, 50]),
  contempt: Object.freeze([15, 15, 50, 20]),
});

function weights(values) {
  const safe = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const maximum = Math.max(...safe);
  if (!maximum) return null;
  const scaled = safe.map(value => value / maximum);
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return scaled.map(value => value / total);
}

// Largest remainders produce stable whole percentages that always sum to 100.
export function normalizeRecipe(recipe) {
  const normalized = weights(CHANNELS.map(({key}) => recipe?.percentages?.[key]));
  if (!normalized) return null;
  const exact = normalized.map(value => value * 100);
  const integers = exact.map(Math.floor);
  const remaining = 100 - integers.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({index, remainder: value - integers[index]}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) integers[order[i].index]++;
  return {
    code: `SC-${integers.map(value => String(value).padStart(2, '0')).join('-')}`,
    percentages: Object.fromEntries(CHANNELS.map(({key}, index) => [key, integers[index]])),
    dominant: EMOTIONS.includes(recipe?.dominant) ? recipe.dominant : null,
  };
}

export function recipeForScores(scores) {
  const distribution = weights(EMOTIONS.map(key => scores?.[key]));
  if (!distribution) return null;
  const percentages = Object.fromEntries(CHANNELS.map(({key}, index) => [key,
    distribution.reduce((sum, weight, emotionIndex) => sum + weight * SCENT_PROFILES[EMOTIONS[emotionIndex]][index], 0)]));
  return normalizeRecipe({percentages, dominant: EMOTIONS[distribution.indexOf(Math.max(...distribution))]});
}
