import {MusicMatterVisual} from './music-visual.mjs';
import {MUSIC_LAYERS} from './music-math.mjs';

// The same engine and session used by playback own all visual inputs. No second
// soundtrack, microphone stream, timer-generated beat, or preview-only signal.
export function connectMusicVisual({engine, getState}) {
  const panel = document.getElementById('music-panel');
  const stage = document.getElementById('music-visual-stage');
  const canvas = document.getElementById('music-visual-canvas');
  const status = document.getElementById('music-visual-status');
  const fallback = document.getElementById('music-visual-fallback');
  const freeze = document.getElementById('music-visual-freeze');
  const fullscreen = document.getElementById('music-visual-fullscreen');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const meters = Object.fromEntries(MUSIC_LAYERS.map(name => [name, document.getElementById(`music-${name}-fill`)]));
  let visual = null, attempted = false, frozen = false, disposed = false, visualError = null;
  let raf = 0, lastFrame = 0, lastMeter = 0, settleUntil = 0, signature = '', inView = true;
  let fullscreenNoticeUntil = 0;
  let redrawFrozen = false;
  const visible = () => !document.hidden && !panel.hidden && inView;
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };

  function ensureVisual() {
    if (attempted) return;
    attempted = true;
    try {
      visual = new MusicMatterVisual(canvas, {onError: error => {
        visualError = error;
        fallback.hidden = !error;
        freeze.disabled = Boolean(error);
        // Context restoration must also restart a previously idle render loop.
        if (!error) { redrawFrozen = true; refresh(true); }
      }});
    } catch (error) {
      visualError = error;
      fallback.hidden = false;
      freeze.disabled = true;
      canvas.dataset.status = 'unavailable';
    }
  }

  function updateStatus(audio) {
    const state = getState();
    const label = fullscreenNoticeUntil > performance.now() ? '当前无法进入全屏，可继续在此体验'
      : visualError ? '画面暂不可用 · 音乐可继续播放'
      : frozen ? '画面已暂停 · 声音可继续播放'
      : !audio.playing ? '开启声音，唤醒形变'
      : audio.volume === 0 ? '已静音 · 形变静息'
      : reducedMotion.matches ? '随声流动 · 已减少动态'
      : state.preview ? '随声流动 · 情绪预览'
      : state.scores ? '随声流动 · 跟随群体' : '随声流动 · 待机声景';
    setText(status, label);
    stage.dataset.playing = String(audio.playing);
    stage.dataset.source = state.preview ? 'preview' : state.scores ? 'group' : 'idle';
  }

  function stopLoop() { cancelAnimationFrame(raf); raf = 0; lastFrame = 0; }
  function wake() { if (!disposed && visible() && !raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (disposed || !visible()) { lastFrame = 0; return; }
    if (lastFrame && now - lastFrame < 32) { wake(); return; }
    const dt = lastFrame ? Math.min(.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    ensureVisual();
    const audio = engine.getVisualAnalysis();
    const playback = engine.getStatus();
    const state = getState();
    if ((!frozen || redrawFrozen) && visual) {
      if (visual.render({dt: frozen ? 0 : dt, audio, scores: state.scores, parameters: state.parameters, reducedMotion: reducedMotion.matches})) redrawFrozen = false;
    }
    if (now - lastMeter >= 100) {
      for (const name of MUSIC_LAYERS) {
        // Fixed display gain makes quiet orchestral passages legible; these are
        // measured amplitudes, never the planned layer gains shown before.
        const strength = Math.min(1, Math.sqrt(Math.max(0, audio.layers[name] || 0)) * 2.8);
        meters[name].style.width = `${(strength * 100).toFixed(1)}%`;
      }
      canvas.dataset.rms = audio.rms.toFixed(6);
      canvas.dataset.bass = audio.bass.toFixed(6);
      canvas.dataset.treble = audio.treble.toFixed(6);
      updateStatus(playback);
      lastMeter = now;
    }
    if (playback.playing && playback.volume > 0 || now < settleUntil) wake();
  }

  function refresh(force = false) {
    if (disposed) return;
    const playback = engine.getStatus();
    const state = getState();
    const next = JSON.stringify([playback.playing, playback.volume, state.scores, state.parameters, state.preview, frozen, reducedMotion.matches]);
    if (force || next !== signature) { signature = next; settleUntil = performance.now() + 6000; }
    updateStatus(playback);
    if (!playback.playing || playback.volume === 0) {
      for (const meter of Object.values(meters)) meter.style.width = '0%';
    }
    if (!visible()) stopLoop();
    else wake();
  }

  function toggleFreeze() {
    frozen = !frozen;
    freeze.setAttribute('aria-pressed', String(frozen));
    setText(freeze, frozen ? '继续画面' : '暂停画面');
    lastFrame = 0;
    refresh(true);
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      fullscreenNoticeUntil = performance.now() + 3500;
      refresh(true);
    }
  }
  function onFullscreen() {
    setText(fullscreen.querySelector('span'), document.fullscreenElement === stage ? '退出全屏' : '全屏');
    redrawFrozen = true;
    visual?.resize();
    refresh(true);
  }
  function onVisibility() { refresh(true); }
  function onResize() { redrawFrozen = true; visual?.resize(); refresh(true); }
  freeze.addEventListener('click', toggleFreeze);
  fullscreen.addEventListener('click', toggleFullscreen);
  fullscreen.hidden = !document.fullscreenEnabled || !stage.requestFullscreen;
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  reducedMotion.addEventListener('change', onVisibility);
  const panelObserver = new MutationObserver(() => refresh(true));
  panelObserver.observe(panel, {attributes: true, attributeFilter: ['hidden']});
  const viewportObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting !== false;
    refresh(true);
  }) : null;
  viewportObserver?.observe(stage);
  const sizeObserver = new ResizeObserver(onResize);
  sizeObserver.observe(stage);
  refresh(true);

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true; stopLoop(); visual?.dispose();
      panelObserver.disconnect(); viewportObserver?.disconnect();
      sizeObserver.disconnect();
      freeze.removeEventListener('click', toggleFreeze);
      fullscreen.removeEventListener('click', toggleFullscreen);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      reducedMotion.removeEventListener('change', onVisibility);
    },
  };
}
