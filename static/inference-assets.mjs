// Fixed, public model/runtime downloads only. No image, room credential or
// participant data is sent to these URLs. Original sources remain fallbacks.
export const INFERENCE_ASSET_RELAY = 'https://43.161.198.80/inference-assets/';
export const CLASSIFIER_MIRROR_URL = 'https://cdn.jsdelivr.net/gh/sb-ai-lab/EmotiEffLib@520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx';
const FACE_MIRROR_URL = 'https://cdn.jsdelivr.net/gh/bybybye317-source/emotion-exhibition@a5bb02414db1060733c64236970802b687fd881b/static/inference-models/face_landmarker.task';
export const FACE_MODEL = Object.freeze({
  bytes: 3758596,
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
});
export const RUNTIME_ASSETS = Object.freeze({
  'mediapipe/wasm/vision_wasm_internal.js': {bytes: 204284, sha256: '4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb'},
  'mediapipe/wasm/vision_wasm_internal.wasm': {bytes: 9574032, sha256: 'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7'},
  'mediapipe/wasm/vision_wasm_nosimd_internal.js': {bytes: 204137, sha256: '927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f'},
  'mediapipe/wasm/vision_wasm_nosimd_internal.wasm': {bytes: 9448638, sha256: '3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4'},
  'ort/ort-wasm-simd-threaded.mjs': {bytes: 20856, sha256: '30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8'},
  'ort/ort-wasm-simd-threaded.wasm': {bytes: 11210254, sha256: '71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4'},
});

export function inferenceAssetSources(path, {fallback} = {}) {
  if (path !== 'classifier.onnx' && path !== 'face_landmarker.task' && !Object.hasOwn(RUNTIME_ASSETS, path)) throw new Error('未知识别资源');
  const original = fallback ?? (path === 'face_landmarker.task'
    ? new URL('./inference-models/face_landmarker.task', import.meta.url).href
    : path === 'classifier.onnx' ? [] : new URL(`./vendor/${path}`, import.meta.url).href);
  const relay = new URL(path, INFERENCE_ASSET_RELAY).href;
  const mirror = path === 'classifier.onnx' ? CLASSIFIER_MIRROR_URL : path === 'face_landmarker.task' ? FACE_MIRROR_URL
    : path.startsWith('mediapipe/') ? `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/${path.slice('mediapipe/'.length)}`
    : `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/${path.slice('ort/'.length)}`;
  // Local development has the bundled files and is deliberately outside the
  // production relay's CORS allowlist; use its own assets first.
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(import.meta.url).hostname);
  return [...new Set((localDevelopment ? [...[original].flat(), mirror] : [relay, ...[original].flat(), mirror]).filter(Boolean))];
}

function abortReason(signal) {
  return signal.reason || new DOMException('下载已取消', 'AbortError');
}
function timeoutError(message) {
  return new DOMException(message, 'TimeoutError');
}
function abortable(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(abortReason(signal)); }
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortReason(signal)); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Download with visible progress and deadlines covering headers AND body.
 * onProgress receives {phase, loaded, total, percent, source, attempt, label}.
 * totalTimeoutMs is a single budget across retries/sources, not per request.
 */
export async function fetchBytesWithProgress(sources, {
  label = '识别资源', expectedBytes, sha256, onProgress = () => {}, signal,
  idleTimeoutMs = 20000, totalTimeoutMs = 120000, retries = 1,
  maxBytes = expectedBytes || 64 * 1024 * 1024, fetchImpl = globalThis.fetch,
  raceBytes = 256 * 1024,
} = {}) {
  let urls = [...new Set([sources].flat().filter(Boolean))];
  if (!urls.length) throw new Error('缺少识别资源地址');
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0 || !Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) throw new Error('无效下载时限');
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1)) throw new Error('无效资源大小');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('无效下载大小上限');
  if (sha256 && !/^[a-f\d]{64}$/i.test(sha256)) throw new Error('无效校验值');
  if (typeof fetchImpl !== 'function') throw new Error('当前浏览器不支持下载');
  // Callers cannot accidentally turn a fallback into an unbounded retry loop.
  retries = Math.max(0, Math.min(1, Math.floor(Number(retries) || 0)));
  const overall = new AbortController();
  const cancel = () => overall.abort(abortReason(signal));
  if (signal?.aborted) throw abortReason(signal);
  signal?.addEventListener('abort', cancel, {once: true});
  const deadline = setTimeout(() => overall.abort(timeoutError(`${label}下载超时，请重试`)), totalTimeoutMs);
  let lastError;
  const report = value => { try { onProgress({...value, label}); } catch {} };
  let prepared = null;
  const attemptsUsed = new Map();
  // Measure useful throughput, not just fast response headers. Keep the first
  // 256 KiB and its reader; the winner continues the same GET without a second
  // request. Other GETs are cancelled as soon as a winner is known. At most
  // three fixed sources are raced, so this never fans out without a bound.
  async function raceSources() {
    const candidates = urls.map(source => ({source, request: new AbortController(), reader: null, chunks: [], loaded: 0}));
    let finished = false, remaining = candidates.length, leadingBytes = 0;
    const cleanup = (candidate, abort = true) => {
      clearTimeout(candidate.idle);
      overall.signal.removeEventListener('abort', candidate.relayAbort);
      if (!abort) return;
      candidate.request.abort();
      try { candidate.reader?.cancel()?.catch(() => {}); } catch {}
      try { candidate.reader?.releaseLock(); } catch {}
      candidate.chunks = [];
    };
    return new Promise(resolve => {
      for (const candidate of candidates) {
        attemptsUsed.set(candidate.source, 1);
        candidate.relayAbort = () => candidate.request.abort(abortReason(overall.signal));
        overall.signal.addEventListener('abort', candidate.relayAbort, {once: true});
        const touch = () => {
          clearTimeout(candidate.idle);
          candidate.idle = setTimeout(() => candidate.request.abort(timeoutError(`${label}下载长时间无响应，请重试`)), idleTimeoutMs);
        };
        (async () => {
          touch();
          const response = await abortable(fetchImpl(candidate.source, {signal: candidate.request.signal,
            credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default'}), candidate.request.signal);
          candidate.response = response;
          if (!response.ok) {
            const error = new Error(`${label}下载失败（${response.status}）`);
            error.permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
            throw error;
          }
          touch();
          if (response.body?.getReader) {
            candidate.reader = response.body.getReader();
            while (candidate.loaded < raceBytes) {
              const {done, value} = await abortable(candidate.reader.read(), candidate.request.signal);
              if (done) throw new Error(`${label}大小不符，请重新加载`);
              if (!value?.byteLength) continue;
              candidate.loaded += value.byteLength;
              if (candidate.loaded > maxBytes) throw new Error(`${label}大小超出预期，请重新加载`);
              candidate.chunks.push(value); touch();
              if (candidate.loaded >= leadingBytes) {
                leadingBytes = candidate.loaded;
                report({phase: 'download', loaded: candidate.loaded, total: expectedBytes,
                  percent: Math.min(99, Math.floor(candidate.loaded / expectedBytes * 100)), source: candidate.source, attempt: 1});
              }
            }
          } else {
            // A browser without ReadableStream must complete its one transfer.
            candidate.complete = new Uint8Array(await abortable(response.arrayBuffer(), candidate.request.signal));
            candidate.loaded = candidate.complete.byteLength;
            if (candidate.loaded !== expectedBytes) throw new Error(`${label}大小不符，请重新加载`);
          }
          if (finished) { cleanup(candidate); return; }
          finished = true;
          for (const entry of candidates) cleanup(entry, entry !== candidate);
          resolve(candidate);
        })().catch(error => {
          if (finished) { cleanup(candidate); return; }
          lastError = candidate.request.signal.aborted ? abortReason(candidate.request.signal) : error;
          if (error.permanent) attemptsUsed.set(candidate.source, retries + 1);
          cleanup(candidate);
          if (--remaining === 0) { finished = true; resolve(null); }
        });
      }
    });
  }
  try {
    if (urls.length >= 2 && urls.length <= 3 && Number.isSafeInteger(raceBytes) && raceBytes > 0 && expectedBytes > raceBytes) {
      prepared = await raceSources();
      if (overall.signal.aborted) throw abortReason(overall.signal);
      if (prepared) urls = [prepared.source, ...urls.filter(source => source !== prepared.source)];
    }
    for (const source of urls) for (let attempt = prepared?.source === source ? 1 : (attemptsUsed.get(source) || 0) + 1; attempt <= retries + 1; attempt++) {
      if (overall.signal.aborted) throw abortReason(overall.signal);
      const selected = prepared?.source === source ? prepared : null;
      prepared = null;
      const request = selected?.request || new AbortController();
      const relayAbort = () => request.abort(abortReason(overall.signal));
      overall.signal.addEventListener('abort', relayAbort, {once: true});
      let idle, reader = selected?.reader, loaded = selected?.loaded || 0;
      let total = expectedBytes || null;
      const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => request.abort(timeoutError(`${label}下载长时间无响应，请重试`)), idleTimeoutMs);
      };
      const progress = phase => report({phase, loaded, total, percent: phase === 'done' ? 100 : total ? Math.min(99, Math.floor(loaded / total * 100)) : null, source, attempt});
      try {
        touch(); progress('download');
        const response = selected?.response || await abortable(fetchImpl(source, {
          signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
          cache: attempt > 1 ? 'reload' : 'default',
        }), request.signal);
        if (!response.ok) {
          const error = new Error(`${label}下载失败（${response.status}）`);
          // A permanent missing/forbidden source should go straight to fallback.
          error.permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
          throw error;
        }
        const length = Number(response.headers?.get('content-length'));
        if (!total && Number.isSafeInteger(length) && length > 0) total = length;
        touch(); progress('download');
        let bytes;
        if (selected?.complete) {
          bytes = selected.complete;
        } else if (response.body?.getReader) {
          reader ||= response.body.getReader();
          const chunks = selected?.chunks || [];
          while (true) {
            const {done, value} = await abortable(reader.read(), request.signal);
            if (done) break;
            if (!value?.byteLength) continue;
            loaded += value.byteLength;
            if (loaded > maxBytes) throw new Error(`${label}大小超出预期，请重新加载`);
            chunks.push(value); touch(); progress('download');
          }
          bytes = new Uint8Array(loaded);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        } else {
          bytes = new Uint8Array(await abortable(response.arrayBuffer(), request.signal));
          loaded = bytes.byteLength;
          if (loaded > maxBytes) throw new Error(`${label}大小超出预期，请重新加载`);
          touch(); progress('download');
        }
        if (expectedBytes !== undefined && loaded !== expectedBytes) throw new Error(`${label}大小不符，请重新加载`);
        progress('verify');
        if (sha256) {
          const digest = await abortable(globalThis.crypto.subtle.digest('SHA-256', bytes), request.signal);
          const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
          if (actual !== sha256.toLowerCase()) throw new Error(`${label}校验失败，请重新加载`);
        }
        if (request.signal.aborted) throw abortReason(request.signal);
        progress('done');
        return bytes.buffer;
      } catch (error) {
        lastError = request.signal.aborted ? abortReason(request.signal) : error;
        if (overall.signal.aborted) throw abortReason(overall.signal);
        progress('retry');
        if (error.permanent) break;
      } finally {
        clearTimeout(idle);
        overall.signal.removeEventListener('abort', relayAbort);
        request.abort();
        // Some Safari/network failures never settle cancel(); don't await it.
        try { reader?.cancel()?.catch(() => {}); } catch {}
        try { reader?.releaseLock(); } catch {}
      }
    }
    throw lastError || new Error(`${label}下载失败，请重试`);
  } catch (error) {
    // Keep TimeoutError / AbortError names while separating a failed download
    // from a failed browser runtime. Switching runtimes cannot repair a URL.
    try { error.assetDownload = true; } catch {}
    throw error;
  } finally {
    if (prepared) {
      prepared.request.abort();
      try { prepared.reader?.cancel()?.catch(() => {}); } catch {}
      try { prepared.reader?.releaseLock(); } catch {}
    }
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
  }
}
