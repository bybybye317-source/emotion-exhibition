// VSCO 2 CE is served with this demo; no audio is uploaded or fetched from a CDN.
export const ORCHESTRA_MANIFEST_URL = new URL('./audio/orchestra/manifest.json', import.meta.url).href;
export const MAX_SAMPLE_TRANSPOSE = 3;
const manifests = new Map(), encoded = new Map(), decoded = new WeakMap();
const instrumentLayers = {violin: 'strings', viola: 'strings', cello: 'strings', strings: 'strings', horn: 'brass', trombone: 'brass', brass: 'brass'};

function cached(map, key, factory) {
  if (!map.has(key)) {
    const pending = Promise.resolve().then(factory).catch(error => { map.delete(key); throw error; });
    map.set(key, pending);
  }
  return map.get(key);
}

async function request(url, fetcher, timeoutMs, responseType) {
  // A rejected request is never cached. One retry handles an interrupted local
  // connection; a missing file fails immediately and can be retried by the user.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, {signal: controller.signal});
          if (!response.ok) {
            const error = new Error(`管弦采样文件读取失败（${response.status}）。`);
            error.status = response.status;
            throw error;
          }
          return response[responseType]();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('管弦采样加载超时，请重试。')); }, timeoutMs); }),
      ]);
    } catch (error) {
      if (attempt || (error.status >= 400 && error.status < 500)) throw error;
    } finally { clearTimeout(timer); }
  }
}

export function validateSampleManifest(manifest, manifestUrl = ORCHESTRA_MANIFEST_URL) {
  if (manifest?.version !== 1 || !manifest.instruments || typeof manifest.instruments !== 'object') throw new Error('管弦采样清单格式无效。');
  const entries = [];
  for (const [instrument, samples] of Object.entries(manifest.instruments)) {
    const layer = instrumentLayers[instrument];
    if (!layer || !Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (typeof sample.url !== 'string' || !Number.isFinite(sample.midi) || sample.midi < 0 || sample.midi > 127) throw new Error('管弦采样音高或文件路径无效。');
      const url = new URL(sample.url, manifestUrl).href;
      const loopStart = sample.loopStartSeconds, loopEnd = sample.loopEndSeconds;
      if (!Number.isFinite(loopStart) || !Number.isFinite(loopEnd) || loopStart < 0 || loopEnd <= loopStart + .05) throw new Error('管弦采样缺少有效延音循环。');
      entries.push({
        ...sample, instrument, layer, url, loopStart, loopEnd,
        velocity: Number.isFinite(sample.velocity) ? Math.max(0, Math.min(1, sample.velocity)) : .5,
        gain: Number.isFinite(sample.gain) ? Math.max(.01, Math.min(4, sample.gain)) : 1,
      });
    }
  }
  for (const layer of ['strings', 'brass']) if (!entries.some(entry => entry.layer === layer)) throw new Error(`管弦采样缺少 ${layer === 'strings' ? '弦乐' : '铜管'}。`);
  return {library: String(manifest.library || 'VSCO 2 CE'), license: String(manifest.license || ''), entries};
}

export async function loadOrchestraSamples(context, {manifestUrl = ORCHESTRA_MANIFEST_URL, fetcher = globalThis.fetch, timeoutMs = 15000, onProgress = () => {}} = {}) {
  if (typeof fetcher !== 'function' || typeof context?.decodeAudioData !== 'function') throw new Error('浏览器不支持加载管弦采样。');
  const manifest = await cached(manifests, manifestUrl, async () => validateSampleManifest(await request(manifestUrl, fetcher, timeoutMs, 'json'), manifestUrl));
  let contextCache = decoded.get(context);
  if (!contextCache) { contextCache = new Map(); decoded.set(context, contextCache); }
  let loaded = 0;
  const report = () => { try { onProgress({loaded, total: manifest.entries.length}); } catch {} };
  report();
  const samples = new Array(manifest.entries.length);
  // Four concurrent decodes avoid a large memory spike on mobile/Safari.
  let cursor = 0;
  async function worker() {
    while (cursor < manifest.entries.length) {
      const index = cursor++, entry = manifest.entries[index];
      const buffer = await cached(contextCache, entry.url, async () => {
        const bytes = await cached(encoded, entry.url, () => request(entry.url, fetcher, timeoutMs, 'arrayBuffer'));
        // decodeAudioData can detach its input. Keep the cached bytes intact for
        // subsequent OfflineAudioContexts and audio engine restarts.
        let audio;
        try { audio = await context.decodeAudioData(bytes.slice(0)); }
        catch (error) { encoded.delete(entry.url); throw new Error('管弦采样解码失败，请重试。', {cause: error}); }
        if (!Number.isFinite(audio.duration) || audio.duration <= 0 || entry.loopEnd > audio.duration + .001) throw new Error('管弦采样循环超出录音长度。');
        return audio;
      });
      samples[index] = {...entry, buffer};
      loaded++; report();
    }
  }
  await Promise.all(Array.from({length: Math.min(4, manifest.entries.length)}, worker));
  return {...manifest, samples};
}

export function selectOrchestraSample(bank, event, dynamics = .5) {
  if (!bank?.samples || !Number.isFinite(event.midi)) return null;
  const candidates = bank.samples.filter(sample => sample.layer === event.layer && (!event.instrument || sample.instrument === event.instrument));
  let selected = null, distance = Infinity, dynamicDistance = Infinity;
  for (const sample of candidates) {
    const pitchDistance = Math.abs(sample.midi - event.midi);
    const velocityDistance = Math.abs(sample.velocity - dynamics);
    if (pitchDistance > MAX_SAMPLE_TRANSPOSE) continue;
    if (pitchDistance < distance || (pitchDistance === distance && velocityDistance < dynamicDistance)) {
      selected = sample; distance = pitchDistance; dynamicDistance = velocityDistance;
    }
  }
  return selected ? {...selected, playbackRate: 2 ** ((event.midi - selected.midi) / 12)} : null;
}
