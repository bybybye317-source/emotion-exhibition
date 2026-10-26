import { EmotionMusicEngine } from './music-engine.mjs';
import { musicParameters, groupDiversity, MUSIC_LAYERS } from './music-math.mjs';

const $ = id => document.getElementById(id);
const labels = { happiness: '快乐', neutral: '中性', sadness: '悲伤', surprise: '惊讶', anger: '愤怒', fear: '恐惧', disgust: '厌恶', contempt: '轻蔑' };
const idleAfter = 120_000;
let session = null;
let connected = false;
let preview = 'group';
let participantSignature = '';
let lastParticipation = 0;
let pending = false;
let started = false;
let pauseReason = '';
let errorMessage = '';
let disposed = false;
let target = musicParameters({}, { idle: true });
let source = '等待观众 · 待机声景';

function text(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}

const engine = new EmotionMusicEngine({ onChange: () => render() });
engine.setVolume(Number($('music-volume').value) / 100);

function render() {
  if (disposed) return;
  const audio = engine.getStatus();
  const playing = audio.playing && audio.contextState === 'running';
  const loading = audio.sampleStatus === 'loading';
  $('music-toggle').disabled = pending;
  $('music-toggle').setAttribute('aria-pressed', String(playing));
  text('music-toggle-label', pending ? loading ? '加载音源…' : '请稍候…' : playing ? '暂停声音' : started ? '继续播放' : '开启声音');
  text('music-status', errorMessage ? '音源加载或播放失败' : loading ? `载入采样 · ${audio.sampleProgress?.loaded || 0}/${audio.sampleProgress?.total || '—'}` : pending ? '正在切换' : playing ? '正在播放 · 宇宙织体' : pauseReason || (started ? '已暂停' : '尚未开启'));
  text('music-sample-status', audio.sampleStatus === 'ready' ? '真实管弦采样 × 合成器' : loading ? '正在准备本地管弦音源' : audio.sampleStatus === 'error' ? '采样未就绪 · 可重新开启' : '本地管弦采样 · 点击后载入');
  text('music-source', source);
  $('music-error').hidden = !errorMessage;
  text('music-error', errorMessage);
  const playingParameters = playing ? audio.parameters || target : target;
  const description = playingParameters.idle ? '弦乐与合成器在远处轻声悬浮，等待下一位观众。' : `${playingParameters.mode === 'major' ? '通透开阔' : playingParameters.mode === 'minor' ? '幽深绵长' : '悬浮不定'}的音场 · ${playingParameters.texture > .75 ? '碎片与微光交错浮现' : '稀疏碎片缓慢漂浮'} · ${playingParameters.drift > .75 ? '音色游移，回声向远处散开' : '倒放涌流，色彩缓慢变形'}`;
  text('music-description', description);
  text('music-dynamics-value', `${Math.round((playingParameters.dynamics ?? 0) * 100)}%`);
  text('music-orchestration-value', `${Math.round((playingParameters.orchestration ?? 0) * 100)}%`);
  for (const name of ['texture', 'drift', 'space']) {
    text(`music-${name}-value`, `${Math.round((playingParameters[name] ?? 0) * 100)}%`);
  }
  for (const name of MUSIC_LAYERS) {
    const value = playing ? Math.max(0, Math.min(1, audio.levels?.[name] ?? playingParameters[name] ?? 0)) : 0;
    $( `music-${name}-fill`).style.width = `${Math.round(value * 100)}%`;
  }
  const panel = $('music-toggle').closest('section');
  if (panel) {
    panel.dataset.playing = String(playing);
    panel.dataset.source = preview !== 'group' ? 'preview' : target.idle ? 'idle' : 'group';
    panel.dataset.emotion = target.dominant || 'neutral';
  }
}

function updateTarget() {
  if (disposed) return;
  const participants = session?.participants || [];
  if (preview !== 'group') {
    target = musicParameters({ [preview]: 1 });
    source = `联动预览 · ${labels[preview]} · 不写入观众记录`;
  } else {
    const idle = !connected || !participants.length || Date.now() - lastParticipation >= idleAfter;
    target = musicParameters(session?.group_scores || {}, { idle, diversity: idle ? 0 : groupDiversity(participants) });
    source = !connected ? '连接中断 · 待机声景' : !participants.length ? '等待观众 · 待机声景' : idle ? '两分钟无人新增 · 待机声景' : `跟随群体 · ${participants.length} 位观众 · ${labels[target.dominant] || '混合表情'}`;
  }
  engine.setTarget(target);
  render();
}

function acceptState(event) {
  const detail = event.detail;
  if (!detail?.state?.session) return;
  connected = Boolean(detail.connected);
  session = detail.state.session;
  const participants = session.participants || [];
  const signature = participants.map(person => person.id).join('|');
  if (signature !== participantSignature) {
    participantSignature = signature;
    // The backend timestamps are timezone-qualified. A reload must not make
    // an old session sound newly active; reconnects keep the same idle timer.
    const latest = Math.max(...participants.map(person => Date.parse(person.time)).filter(Number.isFinite), 0);
    lastParticipation = latest > 0 ? Math.min(Date.now(), latest) : Date.now();
  }
  updateTarget();
}

function selectPreview(value, origin) {
  if (value !== 'group' && !Object.hasOwn(labels, value)) value = 'group';
  preview = value;
  $('artwork-preview').value = value;
  if ($('portrait-preview').value !== value) {
    $('portrait-preview').value = value;
    // Reuse the portrait's existing listener; preview never touches the API.
    if (origin !== 'portrait') $('portrait-preview').dispatchEvent(new Event('change'));
  }
  updateTarget();
  window.dispatchEvent(new CustomEvent('emotion:preview', {detail: {value}}));
}

$('artwork-preview').addEventListener('change', event => selectPreview(event.target.value, 'artwork'));
$('portrait-preview').addEventListener('change', event => selectPreview(event.target.value, 'portrait'));
$('music-volume').addEventListener('input', event => {
  const percent = Math.max(0, Math.min(100, Number(event.target.value) || 0));
  engine.setVolume(percent / 100);
  text('music-volume-value', `${percent}%`);
});

$('music-toggle').addEventListener('click', async () => {
  if (pending || disposed) return;
  pending = true;
  errorMessage = '';
  pauseReason = '';
  const audio = engine.getStatus();
  render();
  try {
    if (audio.playing && audio.contextState === 'running') {
      await engine.pause();
    } else {
      // AudioContext creation/resume stays in the user's click handler.
      await engine.start();
      started = started || engine.getStatus().playing;
      if (document.hidden) {
        await engine.pause();
        pauseReason = '已暂停 · 页面离开前台';
      }
    }
  } catch (error) {
    errorMessage = `声音未能启动：${error?.message || '请刷新页面后重试。'}`;
  } finally {
    pending = false;
    render();
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden && (engine.getStatus().playing || pending)) {
    pauseReason = '已暂停 · 页面离开前台';
    try { await engine.pause(); } catch { /* Browser may already suspend audio. */ }
    render();
  }
});
window.addEventListener('emotion:state', acceptState);
window.dispatchEvent(new Event('emotion:state-request'));
const timer = window.setInterval(updateTarget, 1000);
window.addEventListener('pagehide', event => {
  if (event.persisted) {
    pauseReason = '已暂停';
    engine.pause().catch(() => {});
    return;
  }
  disposed = true;
  window.clearInterval(timer);
  window.removeEventListener('emotion:state', acceptState);
  engine.dispose();
});
updateTarget();
