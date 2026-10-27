// Authored exhibition associations: these are artistic choices, not therapeutic or psychological claims.
export const CHANNELS = Object.freeze([
  {key: 'bergamot', label: '佛手柑', color: '#d9b85b', family: '柑橘调', character: '明亮 · 清脆 · 微苦', story: '以清亮的柑橘轮廓描绘向外展开的光。'},
  {key: 'neroli', label: '橙花', color: '#dbc7a1', family: '花香调', character: '柔和 · 透明 · 花瓣', story: '用透明花香保留情绪中柔软而轻盈的部分。'},
  {key: 'lavender', label: '薰衣草', color: '#afa1ce', family: '芳香调', character: '干燥 · 花草 · 绵长', story: '以绵长的花草气息表达放慢的时间。'},
  {key: 'greenleaf', label: '绿叶', color: '#87aa8c', family: '绿意调', character: '青绿 · 潮湿 · 锐利', story: '用湿润而有棱角的绿意描绘警觉与变化。'},
  {key: 'cedar', label: '雪松', color: '#bf9673', family: '木质调', character: '干燥 · 直立 · 深沉', story: '用干燥木质为强烈或低沉的情绪建立重量。'},
  {key: 'vetiver', label: '岩兰草', color: '#94936c', family: '根系调', character: '土壤 · 根系 · 低回', story: '以根系与土壤的意象表达向内沉降的层次。'},
  {key: 'frankincense', label: '乳香', color: '#adb7c9', family: '树脂调', character: '树脂 · 烟雾 · 空旷', story: '让树脂与烟雾成为未知空间的隐喻。'},
  {key: 'pepper', label: '黑胡椒', color: '#c77f6d', family: '辛香调', character: '辛锐 · 颗粒 · 跳动', story: '以辛锐颗粒描绘情绪中的冲撞和突变。'},
].map(Object.freeze));
export const EMOTIONS = Object.freeze(['happiness', 'neutral', 'sadness', 'surprise', 'anger', 'fear', 'disgust', 'contempt']);
export const EMOTION_LABELS = Object.freeze({happiness: '快乐', neutral: '中性', sadness: '悲伤', surprise: '惊讶', anger: '愤怒', fear: '恐惧', disgust: '厌恶', contempt: '轻蔑'});
export const PHASE_DURATIONS = Object.freeze({mixing: 9000, releasing: 7000, purging: 8000, waiting: 5000});
export const SCENT_PROFILES = Object.freeze({
  happiness: Object.freeze([32, 25, 12, 12, 7, 4, 5, 3]),
  neutral: Object.freeze([12, 13, 18, 15, 17, 10, 12, 3]),
  sadness: Object.freeze([5, 11, 18, 10, 24, 20, 10, 2]),
  surprise: Object.freeze([28, 14, 6, 22, 6, 4, 10, 10]),
  anger: Object.freeze([6, 4, 3, 12, 24, 18, 11, 22]),
  fear: Object.freeze([4, 6, 10, 23, 13, 15, 25, 4]),
  disgust: Object.freeze([5, 3, 9, 32, 14, 19, 8, 10]),
  contempt: Object.freeze([6, 5, 7, 11, 29, 22, 13, 7]),
});

function weights(values) {
  const safe = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const maximum = Math.max(...safe);
  if (!maximum) return null;
  const scaled = safe.map(value => value / maximum);
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return scaled.map(value => value / total);
}

// Largest remainders keep both the displayed recipe and its explanation additive.
function apportion(values, total) {
  const normalized = weights(values);
  if (!normalized) return values.map(() => 0);
  const exact = normalized.map(value => value * total);
  const integers = exact.map(Math.floor);
  const remaining = total - integers.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({index, remainder: value - integers[index]}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) integers[order[i].index]++;
  return integers;
}

function emotionDistribution(scores) {
  const values = EMOTIONS.map(key => scores?.[key]);
  if (!weights(values)) return null;
  // A stable nine-decimal representation avoids meaningless source drift on repeated normalization.
  return apportion(values, 1e9).map(value => value / 1e9);
}

function rawIngredients(distribution) {
  return CHANNELS.map((_, index) => distribution.reduce((sum, weight, emotionIndex) =>
    sum + weight * SCENT_PROFILES[EMOTIONS[emotionIndex]][index], 0));
}

function makeRecipe(integers, distribution, manualDominant = null) {
  return {
    code: `SC-${integers.map(value => String(value).padStart(2, '0')).join('-')}`,
    percentages: Object.fromEntries(CHANNELS.map(({key}, index) => [key, integers[index]])),
    dominant: distribution ? EMOTIONS[distribution.indexOf(Math.max(...distribution))]
      : EMOTIONS.includes(manualDominant) ? manualDominant : null,
    emotionWeights: distribution ? Object.fromEntries(EMOTIONS.map((key, index) => [key, distribution[index]])) : null,
    contributions: distribution ? Object.fromEntries(CHANNELS.map(({key}, index) => {
      const points = apportion(distribution.map((weight, emotionIndex) =>
        weight * SCENT_PROFILES[EMOTIONS[emotionIndex]][index]), integers[index] * 10);
      return [key, Object.fromEntries(EMOTIONS.map((emotion, emotionIndex) => [emotion, points[emotionIndex] / 10]))];
    })) : null,
  };
}

export function normalizeRecipe(recipe) {
  const values = CHANNELS.map(({key}) => recipe?.percentages?.[key]);
  if (!weights(values)) return null;
  const integers = apportion(values, 100);
  const distribution = emotionDistribution(recipe?.emotionWeights);
  // Only retain provenance if those emotion weights actually reproduce this recipe.
  // Caller-supplied contributions are never trusted or copied.
  const reproducible = distribution && apportion(rawIngredients(distribution), 100)
    .every((value, index) => value === integers[index]);
  return makeRecipe(integers, reproducible ? distribution : null, recipe?.dominant);
}

export function recipeForScores(scores) {
  const distribution = emotionDistribution(scores);
  if (!distribution) return null;
  return makeRecipe(apportion(rawIngredients(distribution), 100), distribution);
}

export function explainIngredient(recipe, key) {
  const channel = CHANNELS.find(item => item.key === key);
  const normalized = normalizeRecipe(recipe);
  if (!channel || !normalized) return {percent: 0, contributions: [], rationale: '暂无可解释的原料配方。'};
  const percent = normalized.percentages[key];
  if (!normalized.emotionWeights) return {
    percent, contributions: [], rationale: `${channel.label}占 ${percent}%。此配方没有情绪来源记录，仅显示原料构成。`,
  };
  const contributions = EMOTIONS.map(emotion => ({emotion,
    weight: normalized.emotionWeights[emotion], points: normalized.contributions[key][emotion]}))
    .filter(item => item.points > 0).sort((a, b) => b.points - a.points);
  const source = contributions.slice(0, 2).map(item => `${EMOTION_LABELS[item.emotion]}贡献 ${item.points.toFixed(1)} 个百分点`).join('、');
  return {percent, contributions, rationale: percent
    ? `在本作品的艺术映射中，${source}。${channel.story}`
    : `当前配方未分配${channel.label}；这些关联由创作者设定。`};
}
