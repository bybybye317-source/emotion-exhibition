import {ScentRibbon} from './scent-ribbon.mjs?v=20261028-gallery192';
import {recipeForScores, CHANNELS, EMOTION_LABELS, explainIngredient} from './scent-math.mjs?v=20261028-fast';
import {ScentSimulator} from './scent-engine.mjs?v=20261028-fast';
import {deriveFluidState} from './scent-fluid.mjs?v=20261028-fast';
import {ScentInstrument} from './scent-instrument.mjs?v=20261028-fast';

const $ = id => document.getElementById(id);
const phaseLabels = {stopped:'尚未开启',idle:'等待数据',mixing:'调配中',releasing:'模拟释放中',purging:'模拟清味中',waiting:'等待下一轮'};
const stopLabels = {'not-started':'尚未开启',manual:'已手动停止',disconnected:'连接中断 · 已停止',hidden:'页面离开前台 · 已停止',cleared:'本轮已清空 · 已停止',heartbeat:'计时中断 · 已停止'};
const phaseDetails = {
  mixing:'八支原料按本轮比例汇入混合舱，释放口保持关闭。',
  releasing:'混合后的气味缓缓释放，舱内液面逐渐回落；新情绪留待下一轮。',
  purging:'香气通道关闭，洁净空气沿独立管路完成清味。',
  waiting:'清味结束，所有通道关闭，等待下一轮调配。',
  idle:'等待一位观众加入，或选择一种情绪预览。',
  stopped:'选择情绪或加入观众，再开启模拟。',
};
const simulator = new ScentSimulator();
const timeOrigin = Date.now() - performance.now();
let session = null;
let connected = false;
let sawConnection = false;
let previousCount = 0;
let participantSignature = '';
let lastParticipation = 0;
let lastTargetUpdate = 0;
let preview = $('artwork-preview').value || 'group';
let source = '等待观众';
let disposed = false;
let logSignature = '';
let explanationSignature = '';
let selectedKey = CHANNELS[0].key;
let explanationView = 'current';
let instrument = null;
const ribbon=new ScentRibbon($('scent-ribbon'),{onSelect:selectIngredient});
const ingredientButtons = new Map();

function text(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}
function selectIngredient(key) {
  if (!CHANNELS.some(channel => channel.key === key)) return;
  selectedKey = key;
  render();
}
for (const channel of CHANNELS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scent-ingredient-button';
  button.dataset.scentIngredient = channel.key;
  button.style.setProperty('--ingredient-color', channel.color);
  const label = document.createElement('span');
  label.className = 'scent-material-name';
  label.textContent = channel.label;
  const ratio = document.createElement('span');
  ratio.className = 'scent-material-ratio';
  const delta = document.createElement('span');
  delta.className = 'scent-material-delta';
  button.append(label, ratio, delta);
  button.addEventListener('click', () => selectIngredient(channel.key));
  $('scent-ingredients').append(button);
  ingredientButtons.set(channel.key, {button, ratio, delta});
}
try {
  instrument = new ScentInstrument($('scent-instrument'), {onSelect: selectIngredient});
} catch (error) {
  console.error('Scent instrument could not initialize', error);
  $('scent-instrument').textContent = '仪器暂未加载，可以在下方查看配方与情绪来源。';
}

function nameRecipe(recipe) {
  if (!recipe) return '等待一份情绪';
  return [...CHANNELS].sort((a,b) => recipe.percentages[b.key] - recipe.percentages[a.key])
    .filter(channel => recipe.percentages[channel.key] > 0).slice(0,2).map(channel => channel.label).join(' · ');
}
function signed(value) { return value > 0 ? `+${value}` : String(value); }

function renderExplanation(state, currentRecipe) {
  const channel = CHANNELS.find(item => item.key === selectedKey);
  const recipe = explanationView === 'target' ? state.targetRecipe : currentRecipe;
  const signature = JSON.stringify([selectedKey, explanationView, recipe, state.targetRecipe?.percentages, currentRecipe?.percentages, !!state.activeRecipe]);
  if (signature === explanationSignature) return;
  explanationSignature = signature;
  text('scent-ingredient-number', `INGREDIENT / ${String(CHANNELS.indexOf(channel) + 1).padStart(2,'0')} · ${channel.family}`);
  text('scent-ingredient-name', channel.label);
  text('scent-ingredient-character', channel.character);
  $('scent-inspector').style.setProperty('--ingredient-color', channel.color);
  text('scent-explain-current', state.activeRecipe ? '本轮配方' : '准备配方');
  for (const view of ['current','target']) {
    const tab = $(`scent-explain-${view}`);
    tab.setAttribute('aria-selected', String(explanationView === view));
    tab.tabIndex = explanationView === view ? 0 : -1;
  }
  $('scent-explanation').setAttribute('aria-labelledby', `scent-explain-${explanationView}`);
  text('scent-selected-ratio', recipe ? `${recipe.percentages[channel.key]}%` : '—');
  const delta = state.targetRecipe && currentRecipe ? state.targetRecipe.percentages[channel.key] - currentRecipe.percentages[channel.key] : null;
  $('scent-selected-delta').hidden = delta === null;
  if (delta !== null) text('scent-selected-delta', explanationView === 'target'
    ? `目标相对${state.activeRecipe ? '本轮' : '准备配方'} ${signed(delta)} 个百分点 · 当前仪器仍显示${state.activeRecipe ? '本轮' : '准备'}配方`
    : `下一轮目标 ${state.targetRecipe.percentages[channel.key]}% · ${delta ? `${signed(delta)} 个百分点` : '比例相同'}`);
  const explanation = recipe ? explainIngredient(recipe, channel.key) : null;
  text('scent-rationale', explanation?.rationale || `${channel.story}选择情绪或加入观众后，这里将解释它为何进入配方。`);
  const rows = (explanation?.contributions || []).map(item => {
    const row = document.createElement('div');
    row.className = 'scent-contribution';
    const line = document.createElement('div');
    line.className = 'scent-contribution-text';
    const emotion = document.createElement('span');
    emotion.textContent = `${EMOTION_LABELS[item.emotion]} · ${(item.weight * 100).toFixed(1)}%`;
    const points = document.createElement('strong');
    points.textContent = `${item.points.toFixed(1)} 点`;
    line.append(emotion, points);
    const track = document.createElement('div');
    track.className = 'scent-contribution-track';
    track.setAttribute('aria-hidden','true');
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, item.points / Math.max(1, explanation.percent) * 100)}%`;
    track.append(fill);
    row.append(line,track);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'scent-empty';
    empty.textContent = !recipe ? '等待情绪输入' : !recipe.emotionWeights ? '此配方没有完整情绪来源记录' : '此原料当前未分配比例';
    rows.push(empty);
  }
  $('scent-contributions').replaceChildren(...rows);
  text('scent-origin-note', recipe?.emotionWeights
    ? `${explanationView === 'target' ? '左侧为目标' : state.activeRecipe ? '左侧为本轮锁定的' : '左侧为配方采用的'}情绪权重；右侧以百分点计，合计为此原料的配方占比。`
    : '加入观众后采用群体情绪的完整分布；预览不会写入观众记录。');
}

function render() {
  if (disposed) return;
  const state = simulator.snapshot();
  const fluid = deriveFluidState(state);
  const recipe = state.activeRecipe || state.smoothedRecipe || state.targetRecipe;
  const panel = $('scent-panel');
  const phaseChanged = panel.dataset.phase !== state.phase;
  panel.dataset.phase = state.phase;
  panel.dataset.enabled = String(state.enabled);
  panel.dataset.source = preview === 'group' ? 'group' : 'preview';
  text('scent-status', state.phase === 'stopped' ? stopLabels[state.reason] || '模拟已停止' : fluid.stage === 'dosing' ? '原料汇流中' : fluid.stage === 'blending' ? '缓慢混合中' : phaseLabels[state.phase]);
  text('scent-source', source);
  text('scent-recipe-name', nameRecipe(recipe));
  text('scent-recipe-code', recipe?.code || '—');
  text('scent-recipe-heading', state.activeRecipe ? '本轮锁定配方' : '准备配方');
  text('scent-toggle-label', state.enabled ? '模拟运行中' : '开启模拟');
  $('scent-toggle').disabled = state.enabled || (preview === 'group' && !connected);
  $('scent-toggle').setAttribute('aria-pressed', String(state.enabled));
  $('scent-stop').disabled = !state.enabled;
  for (const button of document.querySelectorAll('[data-scent-preview]')) button.setAttribute('aria-pressed', String(preview === button.dataset.scentPreview));
  text('scent-countdown', ['stopped','idle'].includes(state.phase) ? '—' : `${Math.max(0, Math.ceil(state.remaining))} 秒`);
  text('scent-detail', fluid.stage === 'dosing' ? '不同颜色的原料沿各自管道汇入舱内，释放口保持关闭。' : fluid.stage === 'blending' ? '进料完成，八种颜色在舱内缓慢交融；混合后才开始释放。' : phaseDetails[state.phase] || phaseDetails.stopped);
  const progress = Math.round(Math.max(0, Math.min(1, state.progress || 0)) * 100);
  $('scent-progress').setAttribute('aria-valuenow', String(progress));
  $('scent-progress').setAttribute('aria-valuetext', `${phaseLabels[state.phase] || '停止'}，${progress}%`);
  $('scent-progress-fill').style.transition = phaseChanged ? 'none' : '';
  $('scent-progress-fill').style.width = `${progress}%`;
  for (const item of document.querySelectorAll('[data-scent-phase]')) {
    const active = item.dataset.scentPhase === state.phase;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  }
  for (const channel of CHANNELS) {
    const {button,ratio,delta} = ingredientButtons.get(channel.key);
    const percent = recipe?.percentages[channel.key];
    ratio.textContent = recipe ? `${percent}%` : '—';
    const change = state.targetRecipe && recipe ? state.targetRecipe.percentages[channel.key] - percent : 0;
    delta.textContent = state.pending ? `目标 ${signed(change)} 点` : channel.family;
    button.setAttribute('aria-pressed', String(selectedKey === channel.key));
    button.setAttribute('aria-label', `${channel.label}，${recipe ? percent + '%' : '暂无配方'}，查看情绪来源`);
  }
  $('scent-pending').hidden = !state.pending;
  if (state.pending && state.targetRecipe) text('scent-pending', '新情绪已进入下一轮目标。本轮配方与解释保持不变，后续调配将逐步靠近目标；点击“下一轮目标”查看变化。');
  instrument?.update({phase:state.phase,progress:state.progress,outputs:state.outputs,purge:state.purge,recipe,activeRecipe:state.activeRecipe,targetRecipe:state.targetRecipe,pending:state.pending,selectedKey,enabled:state.enabled});
  renderExplanation(state, recipe);
  ribbon.update({phase:state.phase,progress:state.progress,outputs:state.outputs,purge:state.purge,recipe,activeRecipe:state.activeRecipe,targetRecipe:state.targetRecipe,pending:state.pending,selectedKey,enabled:state.enabled});
  const signature = JSON.stringify(state.logs);
  if (signature !== logSignature) {
    logSignature = signature;
    $('scent-log').replaceChildren(...state.logs.map(entry => {
      const row = document.createElement('li');
      const stamp = document.createElement('time');
      stamp.textContent = new Date(timeOrigin + entry.at).toLocaleTimeString('zh-CN',{hour12:false});
      const message = document.createElement('span');
      message.textContent = entry.message + (entry.code ? ` · ${entry.code}` : '');
      row.append(stamp,message);
      return row;
    }));
    $('scent-log').hidden = !state.logs.length;
  }
}
function updateTarget() {
  if (disposed) return;
  lastTargetUpdate = performance.now();
  const count = session?.participant_count || 0;
  if (preview !== 'group') {
    source = `目标输入 · 联动预览 · ${EMOTION_LABELS[preview]} · 不写入观众记录`;
    simulator.setTarget(recipeForScores({[preview]:1}));
  } else {
    const inactive = count > 0 && Date.now() - lastParticipation >= 120_000;
    source = !connected ? '数据连接暂不可用 · 可选择情绪预览' : inactive ? '两分钟无人新增 · 等待下一位' : count ? `目标输入 · 群体情绪 · ${count} 位观众` : '等待观众 · 或从一种情绪开始';
    simulator.setTarget(connected && count && !inactive ? recipeForScores(session.group_scores) : null);
  }
  render();
}
function acceptState(event) {
  const detail = event.detail;
  if (!detail?.state?.session) return;
  const nextConnected = Boolean(detail.connected);
  if (sawConnection && connected && !nextConnected) simulator.stop('disconnected');
  connected = nextConnected;
  if (connected) sawConnection = true;
  session = detail.state.session;
  const count = session.participant_count || 0;
  const participants = session.participants || [];
  const signature = participants.map(person => person.id).join('|');
  if (signature !== participantSignature) {
    participantSignature = signature;
    const latest = Math.max(...participants.map(person => Date.parse(person.time)).filter(Number.isFinite),0);
    lastParticipation = latest > 0 ? Math.min(Date.now(),latest) : Date.now();
  }
  if (previousCount > 0 && count === 0) simulator.stop('cleared');
  previousCount = count;
  updateTarget();
}
$('scent-toggle').addEventListener('click', () => {
  if (preview === 'group' && !connected) return;
  updateTarget();
  simulator.start();
  render();
});
$('scent-stop').addEventListener('click', () => {simulator.stop('manual');render();});
for (const button of document.querySelectorAll('[data-scent-preview]')) button.addEventListener('click', () => {
  $('artwork-preview').value = button.dataset.scentPreview;
  $('artwork-preview').dispatchEvent(new Event('change', {bubbles:true}));
});
for (const view of ['current','target']) {
  const tab = $(`scent-explain-${view}`);
  tab.addEventListener('click', () => {explanationView = view;render();});
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    explanationView = event.key === 'Home' ? 'current' : event.key === 'End' ? 'target' : view === 'current' ? 'target' : 'current';
    render();
    $(`scent-explain-${explanationView}`).focus();
  });
}
window.addEventListener('emotion:state', acceptState);
window.addEventListener('emotion:preview', event => {
  const value = event.detail?.value;
  if (value !== 'group' && !Object.hasOwn(EMOTION_LABELS,value)) return;
  preview = value;
  updateTarget();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {simulator.stop('hidden');render();}
});
window.addEventListener('pagehide', event => {
  simulator.stop('hidden');
  if (!event.persisted) {
    disposed = true;
    clearInterval(timer);
    simulator.dispose();
    instrument?.dispose();ribbon.dispose();
    window.removeEventListener('emotion:state', acceptState);
  }
});
const timer = setInterval(() => {
  if (performance.now() - lastTargetUpdate >= 1000) updateTarget();
  simulator.tick();render();
}, 100);
window.dispatchEvent(new Event('emotion:state-request'));
updateTarget();
