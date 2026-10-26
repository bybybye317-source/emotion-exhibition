import {recipeForScores, CHANNELS} from './scent-math.mjs';
import {ScentSimulator} from './scent-engine.mjs';

const $ = id => document.getElementById(id);
const labels = {happiness:'快乐',neutral:'中性',sadness:'悲伤',surprise:'惊讶',anger:'愤怒',fear:'恐惧',disgust:'厌恶',contempt:'轻蔑'};
const phaseLabels = {stopped:'尚未开启',idle:'等待数据',mixing:'调配中',releasing:'模拟释放中',purging:'模拟清味中',waiting:'等待下一轮'};
const stopLabels = {'not-started':'尚未开启',manual:'已手动停止',disconnected:'连接中断 · 已停止',hidden:'页面离开前台 · 已停止',cleared:'本轮已清空 · 已停止',heartbeat:'计时中断 · 已停止'};
const phaseDetails = {
  mixing:'正在准备本轮配方，所有香气通道保持关闭。',
  releasing:'按本轮锁定比例模拟输出；新配方将在下一轮采用。',
  purging:'香气通道已关闭，正在模拟洁净空气清味。',
  waiting:'清味结束，等待下一轮；香气通道保持关闭。',
  idle:'等待一位观众完成采集，或选择联动预览。',
  stopped:'点击开启模拟，查看配方怎样进入释放与清味过程。',
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

function text(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}

function nameRecipe(recipe) {
  if (!recipe) return '暂无配方';
  return [...CHANNELS].sort((a,b) => recipe.percentages[b.key] - recipe.percentages[a.key])
    .filter(channel => recipe.percentages[channel.key] > 0).slice(0,2).map(channel => channel.label).join(' · ');
}

function render() {
  if (disposed) return;
  const state = simulator.snapshot();
  const recipe = state.activeRecipe || state.smoothedRecipe || state.targetRecipe;
  const panel = $('scent-panel');
  const phaseChanged = panel.dataset.phase !== state.phase;
  panel.dataset.phase = state.phase;
  panel.dataset.enabled = String(state.enabled);
  panel.dataset.source = preview === 'group' ? 'group' : 'preview';
  text('scent-status', state.phase === 'stopped' ? stopLabels[state.reason] || (state.reason ? '模拟已停止' : '尚未开启') : phaseLabels[state.phase]);
  text('scent-source', source);
  text('scent-recipe-name', nameRecipe(recipe));
  text('scent-recipe-code', recipe?.code || '—');
  text('scent-toggle-label', state.enabled ? '模拟运行中' : '开启模拟');
  $('scent-toggle').disabled = state.enabled || (preview === 'group' && !connected);
  $('scent-toggle').setAttribute('aria-pressed', String(state.enabled));
  $('scent-stop').disabled = !state.enabled;
  text('scent-countdown', ['stopped','idle'].includes(state.phase) ? '—' : `${Math.max(0, Math.ceil(state.remaining))} 秒`);
  text('scent-detail', phaseDetails[state.phase] || phaseDetails.stopped);
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
    const ratio = recipe?.percentages?.[channel.key] || 0;
    const output = state.outputs[channel.key] || 0;
    text(`scent-${channel.key}-ratio`, recipe ? `${ratio}%` : '—');
    $(`scent-${channel.key}-fill`).style.width = `${ratio}%`;
    text(`scent-${channel.key}-output`, output > 0 ? `模拟输出 ${output}%` : '通道关闭');
    $(`scent-${channel.key}-output`).classList.toggle('is-on', output > 0);
  }
  $('scent-pending').hidden = !state.pending;
  if (state.pending && state.targetRecipe) {
    const ratios = CHANNELS.map(channel => `${channel.label} ${state.targetRecipe.percentages[channel.key]}%`).join(' · ');
    text('scent-pending', `下一轮目标：${ratios}。当前配方保持不变，将平滑过渡。`);
  }
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
    source = `联动预览 · ${labels[preview]} · 不写入观众记录`;
    simulator.setTarget(recipeForScores({[preview]:1}));
  } else {
    const inactive = count > 0 && Date.now() - lastParticipation >= 120_000;
    source = !connected ? '连接中断 · 等待本机服务' : inactive ? '两分钟无人新增 · 等待下一位' : count ? `跟随群体 · ${count} 位观众` : '等待观众 · 无释放配方';
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
window.addEventListener('emotion:state', acceptState);
window.addEventListener('emotion:preview', event => {
  const value = event.detail?.value;
  if (value !== 'group' && !Object.hasOwn(labels,value)) return;
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
    window.removeEventListener('emotion:state', acceptState);
  }
});
const timer = setInterval(() => {
  if (performance.now() - lastTargetUpdate >= 1000) updateTarget();
  simulator.tick();render();
}, 100);
window.dispatchEvent(new Event('emotion:state-request'));
updateTarget();
