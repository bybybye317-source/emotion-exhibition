import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fetchBytesWithProgress, inferenceAssetSources, FACE_MODEL, RUNTIME_ASSETS, CLASSIFIER_MIRROR_URL} from '../static/inference-assets.mjs';

const payload = new Uint8Array([1, 2, 3, 4]);
const hash = createHash('sha256').update(payload).digest('hex');
const response = () => new Response(payload);
const quick = {idleTimeoutMs: 30, totalTimeoutMs: 200, retries: 0};

test('fixed assets use HTTPS relay then original local path, with explicit classifier origin', () => {
  assert.deepEqual(inferenceAssetSources('classifier.onnx', {fallback: 'https://original.example/model.onnx'}), [
    'https://43.161.198.80/inference-assets/classifier.onnx', 'https://original.example/model.onnx', CLASSIFIER_MIRROR_URL,
  ]);
  const urls = inferenceAssetSources('mediapipe/wasm/vision_wasm_internal.wasm');
  assert.match(urls[0], /^https:\/\/43\.161\.198\.80\/inference-assets\/mediapipe\/wasm\//);
  assert.match(urls[1], /\/static\/vendor\/mediapipe\/wasm\/vision_wasm_internal\.wasm$/);
  assert.equal(urls[2], 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm');
  assert.match(inferenceAssetSources('ort/ort-wasm-simd-threaded.wasm')[2], /onnxruntime-web@1\.22\.0\/dist\/ort-wasm-simd-threaded\.wasm$/);
  assert.match(inferenceAssetSources('face_landmarker.task')[2], /emotion-exhibition@a5bb02414db1060733c64236970802b687fd881b\//);
  assert.match(CLASSIFIER_MIRROR_URL, /EmotiEffLib@520a051c64cd191521e5934655314e769a319684\//);
  assert.throws(() => inferenceAssetSources('../room-secret'), /未知/);
  assert.throws(() => inferenceAssetSources('constructor'), /未知/);
});

test('pinned face and runtime metadata match bundled files exactly', async () => {
  const assets = [['face_landmarker.task', FACE_MODEL], ...Object.entries(RUNTIME_ASSETS)];
  for (const [path, metadata] of assets) {
    const local = path === 'face_landmarker.task' ? `../static/inference-models/${path}` : `../static/vendor/${path}`;
    const bytes = await readFile(new URL(local, import.meta.url));
    assert.equal(bytes.byteLength, metadata.bytes, path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256, path);
  }
});

test('stream progress uses expected size without Content-Length and validates checksum', async () => {
  const events = [], options = [];
  const bytes = await fetchBytesWithProgress('https://asset.example/one', {...quick, expectedBytes: 4, sha256: hash,
    onProgress: event => events.push(event), fetchImpl: async (_url, opts) => {
      options.push(opts);
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(payload.slice(0, 2)); controller.enqueue(payload.slice(2)); controller.close();
      }}));
    },
  });
  assert.deepEqual(new Uint8Array(bytes), payload);
  assert(events.some(event => event.loaded === 2 && event.total === 4 && event.percent === 50));
  assert.equal(events.at(-1).phase, 'done'); assert.equal(events.at(-1).percent, 100);
  assert.equal(options[0].credentials, 'omit'); assert.equal(options[0].referrerPolicy, 'no-referrer');
  assert.equal(options[0].headers, undefined);
});

test('missing expected size and length still report byte progress without invented percent', async () => {
  const events = [];
  await fetchBytesWithProgress('one', {...quick, fetchImpl: async () => response(), onProgress: e => events.push(e)});
  assert(events.some(event => event.loaded === 4 && event.total === null && event.percent === null));
  assert.equal(events.at(-1).phase, 'done');
});

test('permanent HTTP failure moves directly to fallback, and transient retry count is bounded', async () => {
  const calls = [];
  await fetchBytesWithProgress(['blocked', 'offline', 'working'], {...quick, retries: 1000,
    fetchImpl: async (url, options) => {
      calls.push([url, options.cache]);
      if (url === 'blocked') return new Response('', {status: 403});
      if (url === 'offline') throw new TypeError('Failed to fetch');
      return response();
    },
  });
  assert.deepEqual(calls, [['blocked', 'default'], ['offline', 'default'], ['offline', 'reload'], ['working', 'default']]);
});

test('idle timeout covers a fetch that never supplies headers, even when abort is ignored', async () => {
  let requestSignal;
  await assert.rejects(fetchBytesWithProgress('stalled', {...quick,
    fetchImpl: (_url, {signal}) => { requestSignal = signal; return new Promise(() => {}); },
  }), error => error.name === 'TimeoutError' && error.assetDownload && /无响应/.test(error.message));
  assert.equal(requestSignal.aborted, true);
});

test('idle timeout covers a response body that never finishes and cancels its reader', async () => {
  let cancelled = false;
  const stalled = new Response(new ReadableStream({start(controller) { controller.enqueue(payload.slice(0, 2)); }, cancel() { cancelled = true; }}));
  await assert.rejects(fetchBytesWithProgress('stalled-body', {...quick, fetchImpl: async () => stalled}), {name: 'TimeoutError'});
  assert.equal(cancelled, true);
});

test('overall timeout is shared by all retries and is not reset by continuing bytes', async () => {
  let timer, requests = 0;
  await assert.rejects(fetchBytesWithProgress(['one', 'two'], {idleTimeoutMs: 200, totalTimeoutMs: 40, retries: 1,
    fetchImpl: async () => {
      requests++;
      return new Response(new ReadableStream({
        start(controller) { timer = setInterval(() => controller.enqueue(new Uint8Array([1])), 5); },
        cancel() { clearInterval(timer); },
      }));
    },
  }), error => error.name === 'TimeoutError' && /下载超时/.test(error.message));
  assert.equal(requests, 1);
});

test('caller cancellation stops the download and never tries a fallback', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = fetchBytesWithProgress(['one', 'two'], {...quick, signal: controller.signal, fetchImpl: () => { calls++; return new Promise(() => {}); }});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(calls, 1);
  await assert.rejects(fetchBytesWithProgress('one', {...quick, signal: controller.signal, fetchImpl: () => { calls++; }}), {name: 'AbortError'});
  assert.equal(calls, 1);
});

test('wrong size or checksum never returns corrupt model bytes', async () => {
  await assert.rejects(fetchBytesWithProgress('one', {...quick, expectedBytes: 5, fetchImpl: async () => response()}), /大小不符/);
  await assert.rejects(fetchBytesWithProgress('one', {...quick, expectedBytes: 3, fetchImpl: async () => response()}), /大小超出/);
  await assert.rejects(fetchBytesWithProgress('one', {...quick, sha256: '0'.repeat(64), fetchImpl: async () => response()}), /校验失败/);
});

test('integrity failure falls back to a fresh source and progress callbacks cannot break loading', async () => {
  const bytes = await fetchBytesWithProgress(['bad', 'good'], {...quick, expectedBytes: 4, sha256: hash,
    onProgress: () => { throw new Error('UI was unmounted'); },
    fetchImpl: async url => new Response(url === 'bad' ? new Uint8Array(4) : payload),
  });
  assert.deepEqual(new Uint8Array(bytes), payload);
});

test('nonstreaming browser response remains covered by deadlines', async () => {
  const options = {...quick, fetchImpl: async () => ({ok: true, headers: new Headers(), arrayBuffer: () => new Promise(() => {})})};
  await assert.rejects(fetchBytesWithProgress('legacy', options), {name: 'TimeoutError'});
  const bytes = await fetchBytesWithProgress('legacy', {...quick, fetchImpl: async () => ({ok: true, headers: new Headers(), arrayBuffer: async () => payload.buffer})});
  assert.deepEqual(new Uint8Array(bytes), payload);
});

function timedResponse({firstDelay = 0, tailDelay = 5, stalled = false, onCancel = () => {}} = {}) {
  const timers = [];
  return new Response(new ReadableStream({
    start(controller) {
      timers.push(setTimeout(() => {
        controller.enqueue(payload.slice(0, 2));
        if (!stalled) timers.push(setTimeout(() => { controller.enqueue(payload.slice(2)); controller.close(); }, tailDelay));
      }, firstDelay));
    },
    cancel() { timers.forEach(clearTimeout); onCancel(); },
  }));
}

test('large download chooses faster source, keeps its prefix, and aborts slower GET without redownload', async () => {
  const calls = [], signals = {}, progress = []; let cancelled = false;
  const bytes = await fetchBytesWithProgress(['slow', 'fast'], {...quick, expectedBytes: 4, sha256: hash, raceBytes: 2,
    onProgress: event => progress.push(event), fetchImpl: async (url, {signal}) => {
      calls.push(url); signals[url] = signal;
      return timedResponse({firstDelay: url === 'slow' ? 80 : 1, onCancel: () => { if (url === 'slow') cancelled = true; }});
    },
  });
  assert.deepEqual(new Uint8Array(bytes), payload); // requires the retained 1,2 prefix
  assert.deepEqual(calls, ['slow', 'fast']);
  assert(signals.slow.aborted); assert(cancelled);
  assert(progress.some(e => e.source === 'fast' && e.loaded === 2));
  assert.equal(progress.at(-1).phase, 'done');
});

test('winning stream can later stall, then bounded retries recover using the other source', async () => {
  const calls = [];
  const bytes = await fetchBytesWithProgress(['primary', 'other'], {...quick, idleTimeoutMs: 15, retries: 1, expectedBytes: 4, sha256: hash, raceBytes: 2,
    fetchImpl: async url => {
      calls.push(url);
      const attempt = calls.filter(item => item === url).length;
      if (url === 'primary') {
        if (attempt === 1) return timedResponse({stalled: true});
        throw new Error('Primary unavailable');
      }
      return attempt === 1 ? timedResponse({firstDelay: 80}) : response();
    },
  });
  assert.deepEqual(new Uint8Array(bytes), payload);
  assert.deepEqual(calls, ['primary', 'other', 'primary', 'other']);
});

test('both raced sources respect one total deadline even before response headers', async () => {
  const signals = [];
  await assert.rejects(fetchBytesWithProgress(['one', 'two'], {expectedBytes: 4, raceBytes: 2, idleTimeoutMs: 200, totalTimeoutMs: 25,
    fetchImpl: (_url, {signal}) => { signals.push(signal); return new Promise(() => {}); },
  }), error => error.name === 'TimeoutError' && error.assetDownload);
  assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
});

test('caller cancellation terminates both raced readers and leaves no fallback work', async () => {
  const controller = new AbortController(); let cancelled = 0, requests = 0;
  const pending = fetchBytesWithProgress(['one', 'two'], {...quick, expectedBytes: 4, raceBytes: 2, signal: controller.signal,
    fetchImpl: async () => { requests++; return timedResponse({firstDelay: 80, onCancel: () => cancelled++}); },
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(requests, 2); assert.equal(cancelled, 2);
});

test('small assets remain sequential and do not spend bandwidth probing a second source', async () => {
  const calls = [];
  await fetchBytesWithProgress(['one', 'two'], {...quick, expectedBytes: 4, raceBytes: 4,
    fetchImpl: async url => { calls.push(url); return response(); },
  });
  assert.deepEqual(calls, ['one']);
});

test('one raced source may fail while the other continues successfully', async () => {
  const bytes = await fetchBytesWithProgress(['forbidden', 'good'], {...quick, expectedBytes: 4, raceBytes: 2,
    fetchImpl: async url => url === 'forbidden' ? new Response('', {status: 403}) : timedResponse(),
  });
  assert.deepEqual(new Uint8Array(bytes), payload);
});

test('three fixed sources race once and retain the CDN winner while cancelling the slow relay', async () => {
  const calls = [], signals = {}; let cancelled = false;
  const bytes = await fetchBytesWithProgress(['relay', 'origin', 'cdn'], {...quick, expectedBytes: 4, sha256: hash, raceBytes: 2,
    fetchImpl: async (url, {signal}) => {
      calls.push(url); signals[url] = signal;
      if (url === 'origin') return new Response('', {status: 403});
      return timedResponse({firstDelay: url === 'relay' ? 80 : 1, onCancel: () => { if (url === 'relay') cancelled = true; }});
    },
  });
  assert.deepEqual(new Uint8Array(bytes), payload);
  assert.deepEqual(calls, ['relay', 'origin', 'cdn']);
  assert(signals.relay.aborted); assert(cancelled);
});

test('all three raced sources are cancelled by the same overall deadline', async () => {
  const signals = [];
  await assert.rejects(fetchBytesWithProgress(['relay', 'origin', 'cdn'], {expectedBytes: 4, raceBytes: 2, idleTimeoutMs: 200, totalTimeoutMs: 25,
    fetchImpl: (_url, {signal}) => { signals.push(signal); return new Promise(() => {}); },
  }), error => error.name === 'TimeoutError' && error.assetDownload);
  assert.equal(signals.length, 3); assert(signals.every(signal => signal.aborted));
});
