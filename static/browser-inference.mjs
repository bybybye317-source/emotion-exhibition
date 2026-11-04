// Browser-only adaptation of the archived Python pipeline. No input image is
// sent to a server. The classifier is fetched from its original pinned source;
// model weights are not redistributed in this website repository.
import {fetchBytesWithProgress, inferenceAssetSources, FACE_MODEL, RUNTIME_ASSETS} from './inference-assets.mjs?v=20261104-mobile-model';
export const CLASS_ORDER = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise'];
export const MODEL_SOURCE = Object.freeze({
  name: 'enet_b0_8_best_afew',
  url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx',
  bytes: 16039595,
  sha256: '7aa2ea31c1311f4f8aa9d3fdb085d418dd4e7a48c4b9ed41df8c044f91d0213f',
});
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
const local = path => new URL(path, import.meta.url).href;
const createCanvas = (width, height) => typeof document !== 'undefined'
  ? Object.assign(document.createElement('canvas'), {width, height}) : new OffscreenCanvas(width, height);

export function inferenceWorkerSupported(scope = globalThis) {
  if (typeof scope.Worker !== 'function' || typeof scope.OffscreenCanvas !== 'function' || typeof scope.createImageBitmap !== 'function') return false;
  // Mirror the bundled MediaPipe version's canvas gate. Safari 16 has a 2D
  // OffscreenCanvas, but that is insufficient for its worker graphics path.
  const ua = scope.navigator?.userAgent || '';
  if (ua.includes('Safari') && !ua.includes('Chrome')) {
    const version = ua.match(/Version\/(\d+).*Safari/);
    if (!version || Number(version[1]) < 17) return false;
  }
  return true;
}

export function assertWorkerGraphics(scope = globalThis) {
  let context;
  try {
    const canvas = new scope.OffscreenCanvas(1, 1);
    context = canvas.getContext('webgl2') || canvas.getContext('webgl');
  } catch {}
  if (!context) {
    const error = new Error('当前浏览器的后台图形能力不可用');
    error.code = 'INFERENCE_WORKER_CAPABILITY';
    throw error;
  }
  context.getExtension?.('WEBGL_lose_context')?.loseContext();
}

const abortError = () => Object.assign(new Error('识别加载已取消，可重新开启摄像头'), {name: 'AbortError'});
export function initializationDeadline(operation, {label = '识别组件', signal, timeoutMs = 30000, disposeLate = () => {}} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancelled); callback(value); return true;
    };
    const cancelled = () => finish(reject, abortError());
    const timer = setTimeout(() => finish(reject, Object.assign(new Error(`${label}初始化超时，请重试加载`), {code: 'INFERENCE_RUNTIME'})), timeoutMs);
    signal?.addEventListener('abort', cancelled, {once: true});
    if (signal?.aborted) cancelled();
    Promise.resolve(operation).then(value => {
      if (!finish(resolve, value)) Promise.resolve().then(() => disposeLate(value)).catch(() => {});
    }, error => finish(reject, error));
  });
}

export function inferenceProgressText(item) {
  const mb = value => (value / 1048576).toFixed(1);
  if (item.phase === 'retry') return `${item.label}连接较慢，正在重试下载…`;
  if (item.phase === 'verify') return `正在校验${item.label}…`;
  const total = item.total > 0 ? ` / ${mb(item.total)} MB` : ' MB';
  return `${item.label} ${mb(item.loaded)}${total}${Number.isFinite(item.percent) ? ` · ${Math.floor(item.percent)}%` : ''}`;
}

async function downloadAsset(path, label, progress, signal, metadata = RUNTIME_ASSETS[path], fallback) {
  return fetchBytesWithProgress(inferenceAssetSources(path, {fallback}), {
    label, expectedBytes: metadata?.bytes, sha256: metadata?.sha256, signal,
    onProgress: item => progress(inferenceProgressText(item)),
  });
}

export function preprocessRgba(rgba, width = 224, height = 224) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('无效图像数据');
  const pixels = width * height, tensor = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < 3; channel++) tensor[channel * pixels + pixel] = (rgba[pixel * 4 + channel] / 255 - MEAN[channel]) / STD[channel];
  }
  return tensor;
}

export function scoresFromLogits(logits) {
  if (!logits || logits.length !== CLASS_ORDER.length || !Array.from(logits).every(Number.isFinite)) throw new Error('表情模型返回了无效分数');
  const maximum = Math.max(...logits), exponentials = Array.from(logits, value => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(CLASS_ORDER.map((name, index) => [name, exponentials[index] / total]));
}

export function alignmentAnchors(landmarks) {
  const average = (a, b) => [(landmarks[a].x + landmarks[b].x) / 2, (landmarks[a].y + landmarks[b].y) / 2];
  const eyes = [average(33, 133), average(263, 362)].sort((a, b) => a[0] - b[0]);
  const point = index => [landmarks[index].x, landmarks[index].y];
  const corners = [point(61), point(291)].sort((a, b) => a[0] - b[0]);
  // Preserve the original four anchors exactly. Separate lip and opening
  // anchors let the portrait compress photographed teeth into its mouth gap
  // instead of projecting a broad open smile across the physical lips.
  const features={};
  const eyeGroups=[{corner:[33,133],upper:159,lower:145,brow:[70,105,107]},
    {corner:[263,362],upper:386,lower:374,brow:[300,334,336]}]
    .sort((a,b)=>average(...a.corner)[0]-average(...b.corner)[0]);
  for(const [i,group] of eyeGroups.entries()){
    const side=i?'right':'left',sorted=group.corner.map(point).sort((a,b)=>a[0]-b[0]);
    features[`${side}_eye_outer`]=sorted[i?1:0];features[`${side}_eye_inner`]=sorted[i?0:1];
    features[`${side}_eye_upper`]=point(group.upper);features[`${side}_eye_lower`]=point(group.lower);
    ['outer','middle','inner'].forEach((name,j)=>features[`${side}_brow_${name}`]=point(group.brow[j]));
  }
  return {
    ...features,
    left_eye: eyes[0], right_eye: eyes[1], nose: point(1), mouth: average(13, 14),
    mouth_left: corners[0], mouth_right: corners[1],
    mouth_upper_outer: point(0), mouth_upper_inner: point(13),
    mouth_lower_inner: point(14), mouth_lower_outer: point(17),
    mouth_upper_contour: [78,191,80,81,82,13,312,311,310,415,308].map(point).sort((a,b)=>a[0]-b[0]),
    mouth_lower_contour: [78,95,88,178,87,14,317,402,318,324,308].map(point).sort((a,b)=>a[0]-b[0]),
  };
}

export function sharpnessVariance(rgba, width, height) {
  const gray = new Float64Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = .299 * rgba[4 * i] + .587 * rgba[4 * i + 1] + .114 * rgba[4 * i + 2];
  let total = 0, squares = 0, count = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x;
    const value = gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width] - 4 * gray[index];
    total += value; squares += value * value; count++;
  }
  return count ? Math.max(0, squares / count - (total / count) ** 2) : 0;
}

async function fetchClassifier(onProgress, signal) {
  return downloadAsset('classifier.onnx', '下载表情模型', onProgress, signal, MODEL_SOURCE, MODEL_SOURCE.url);
}

// Kept exported for the dedicated worker. The UI uses BrowserEmotionAnalyzer.
export class BrowserInferenceCore {
  constructor() {
    this.ready = false; this.disposed = false; this._initializing = null; this._busy = false;
    this._landmarker = null; this._session = null; this._ort = null; this._controller = null;
    this._frame = createCanvas(1, 1); this._detection = createCanvas(1, 1);
    this._crop = createCanvas(224, 224); this._quality = createCanvas(128, 128);
  }

  async init(onProgress = () => {}) {
    if (this.disposed) throw new Error('识别模块已关闭，请刷新页面');
    if (this.ready) return;
    if (this._initializing) return this._initializing;
    const controller = new AbortController(); this._controller = controller;
    const {signal} = controller;
    let lastProgress = '', lastProgressAt = -Infinity;
    const progress = message => {
      if (signal.aborted || this.disposed || message === lastProgress) return;
      const now = performance.now();
      if (message.includes(' MB') && !message.endsWith('100%') && now - lastProgressAt < 150) return;
      lastProgress = message; lastProgressAt = now;
      try { onProgress(message); } catch {}
    };
    this._initializing = (async () => {
      let landmarker = null, session = null;
      const urls = [];
      const blobUrl = (bytes, type) => { const url = URL.createObjectURL(new Blob([bytes], {type})); urls.push(url); return url; };
      try {
        progress('正在载入浏览器本地识别组件…');
        const [ort, vision] = await initializationDeadline(Promise.all([
          import('./vendor/ort/ort.wasm.min.mjs'), import('./vendor/mediapipe/vision_bundle.mjs'),
        ]), {label: '识别组件', signal});
        // Pages cannot set cross-origin isolation headers. One WASM thread
        // deliberately avoids SharedArrayBuffer and COOP/COEP requirements.
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        const fileset = await initializationDeadline(vision.FilesetResolver.forVisionTasks(local('./vendor/mediapipe/wasm')), {label: '人脸运行环境', signal});
        const loaderPath = `mediapipe/wasm/${new URL(fileset.wasmLoaderPath).pathname.split('/').pop()}`;
        const wasmPath = `mediapipe/wasm/${new URL(fileset.wasmBinaryPath).pathname.split('/').pop()}`;
        const faceBytes = await downloadAsset('face_landmarker.task', '下载人脸定位模型', progress, signal, FACE_MODEL);
        const faceLoader = await downloadAsset(loaderPath, '下载人脸运行组件', progress, signal);
        const faceWasm = await downloadAsset(wasmPath, '下载人脸运行引擎', progress, signal);
        const localFileset = {wasmLoaderPath: blobUrl(faceLoader, 'text/javascript'), wasmBinaryPath: blobUrl(faceWasm, 'application/wasm')};
        progress('下载完成 · 正在启动人脸定位（通常数秒）…');
        landmarker = await initializationDeadline(vision.FaceLandmarker.createFromOptions(localFileset, {
          canvas: createCanvas(1, 1),
          baseOptions: {modelAssetBuffer: new Uint8Array(faceBytes), delegate: 'CPU'},
          runningMode: 'IMAGE', numFaces: 2,
          minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5,
          outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        }), {label: '人脸定位', signal, disposeLate: value => value?.close()});
        const bytes = await fetchClassifier(progress, signal);
        const ortLoader = await downloadAsset('ort/ort-wasm-simd-threaded.mjs', '下载表情运行组件', progress, signal);
        const ortWasm = await downloadAsset('ort/ort-wasm-simd-threaded.wasm', '下载表情运行引擎', progress, signal);
        // Both URLs refer to already verified bytes. ORT's loader still
        // resolves a wasm filename even with wasmBinary, so give it an
        // explicit blob path instead of a relative URL against blob:.
        ort.env.wasm.wasmPaths = {mjs: blobUrl(ortLoader, 'text/javascript'), wasm: blobUrl(ortWasm, 'application/wasm')};
        if (this.disposed) throw new Error('识别模块已关闭');
        progress('正在初始化表情模型，第一次可能需要几秒…');
        session = await initializationDeadline(ort.InferenceSession.create(bytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'}),
          {label: '表情模型', signal, disposeLate: value => value?.release()});
        if (this.disposed) throw new Error('识别模块已关闭');
        this._ort = ort; this._landmarker = landmarker; this._session = session; this.ready = true;
        progress('模型就绪 · 图像只在当前浏览器内处理');
      } catch (error) {
        controller.abort();
        try { landmarker?.close(); } catch {}
        if (session) await session.release();
        if (!error.assetDownload && error.name !== 'AbortError') error.inferenceRuntime = true;
        throw error;
      } finally {
        urls.forEach(url => URL.revokeObjectURL(url));
      }
    })().finally(() => { this._initializing = null; if (this._controller === controller) this._controller = null; });
    return this._initializing;
  }

  async analyze(image) {
    if (!this.ready) await this.init();
    if (this.disposed) throw new Error('识别模块已关闭');
    if (this._busy) throw new Error('正在分析上一帧，请稍后再试');
    this._busy = true;
    let finishAnalysis;
    this._analysisDone = new Promise(resolve => { finishAnalysis = resolve; });
    const started = performance.now();
    const answer = {status: 'no_face', scores: {}, top_emotion: null, detail: '未检测到人脸，请正对镜头', quality: 0, inference_ms: 0, face_count: 0, photo_anchors: null, face_box: null};
    const finish = () => ({...answer, inference_ms: Math.round((performance.now() - started) * 10) / 10});
    try {
      const width = image.videoWidth || image.naturalWidth || image.width, height = image.videoHeight || image.naturalHeight || image.height;
      if (!width || !height || width * height > 20_000_000) throw new Error('图片尚未就绪，或尺寸超过 2000 万像素');
      const frame = this._frame; frame.width = width; frame.height = height;
      // Freeze video once: landmarks, classifier pixels and returned anchors
      // all describe the same frame, even while the video itself advances.
      frame.getContext('2d', {willReadFrequently: true}).drawImage(image, 0, 0, width, height);
      const scale = Math.min(1, 640 / Math.max(width, height));
      const detection = this._detection; detection.width = Math.round(width * scale); detection.height = Math.round(height * scale);
      detection.getContext('2d').drawImage(frame, 0, 0, detection.width, detection.height);
      const result = this._landmarker.detect(detection);
      answer.face_count = result.faceLandmarks.length;
      if (!answer.face_count) return finish();
      if (answer.face_count > 1) { answer.status = 'multiple_faces'; answer.detail = '检测到多张人脸，请一次只让一位观众进入画面'; return finish(); }
      const landmarks = result.faceLandmarks[0];
      const xs = landmarks.map(point => point.x), ys = landmarks.map(point => point.y);
      const rawLeft = Math.min(...xs), rawTop = Math.min(...ys), rawRight = Math.max(...xs), rawBottom = Math.max(...ys);
      const faceWidth = rawRight - rawLeft, faceHeight = rawBottom - rawTop;
      const left = Math.max(0, Math.floor((rawLeft - .04 * faceWidth) * width));
      const top = Math.max(0, Math.floor((rawTop - .04 * faceHeight) * height));
      const right = Math.min(width, Math.ceil((rawRight + .04 * faceWidth) * width));
      const bottom = Math.min(height, Math.ceil((rawBottom + .04 * faceHeight) * height));
      answer.face_box = [left / width, top / height, (right - left) / width, (bottom - top) / height];
      answer.status = 'poor_quality';
      if (right <= left || bottom <= top || Math.min(faceWidth * width, faceHeight * height) < 72 || faceWidth < .10) {
        answer.detail = '人脸太小，请稍微靠近摄像头'; return finish();
      }
      if (rawLeft < -.03 || rawTop < -.03 || rawRight > 1.03 || rawBottom > 1.03) {
        answer.detail = '面部超出画面，请让整张脸进入摄像头'; return finish();
      }
      const anchors = alignmentAnchors(landmarks);
      const delta = [(anchors.right_eye[0] - anchors.left_eye[0]) * width, (anchors.right_eye[1] - anchors.left_eye[1]) * height];
      const roll = Math.abs(Math.atan2(delta[1], delta[0]) * 180 / Math.PI);
      const yaw = Math.abs((anchors.nose[0] - (anchors.left_eye[0] + anchors.right_eye[0]) / 2) * width) / Math.max(1, Math.hypot(...delta));
      if (roll > 40 || yaw > .70) { answer.detail = '面部偏转较大，请正面看向摄像头'; return finish(); }
      const quality = this._quality.getContext('2d', {willReadFrequently: true});
      quality.drawImage(frame, left, top, right - left, bottom - top, 0, 0, 128, 128);
      const blurVariance = sharpnessVariance(quality.getImageData(0, 0, 128, 128).data, 128, 128);
      if (blurVariance < 10) { answer.detail = '画面较模糊，请保持稳定并改善照明'; return finish(); }
      const crop = this._crop.getContext('2d', {willReadFrequently: true});
      crop.imageSmoothingEnabled = true; crop.imageSmoothingQuality = 'low';
      crop.drawImage(frame, left, top, right - left, bottom - top, 0, 0, 224, 224);
      const data = preprocessRgba(crop.getImageData(0, 0, 224, 224).data);
      const tensor = new this._ort.Tensor('float32', data, [1, 3, 224, 224]);
      let outputs;
      try {
        outputs = await this._session.run({[this._session.inputNames[0]]: tensor});
        answer.scores = scoresFromLogits(outputs[this._session.outputNames[0]].data);
      } finally {
        tensor.dispose();
        for (const value of Object.values(outputs || {})) value.dispose();
      }
      answer.status = 'ok'; answer.detail = '已识别一张人脸，分数为表情分类推断';
      answer.top_emotion = CLASS_ORDER.reduce((best, key) => answer.scores[key] > answer.scores[best] ? key : best, CLASS_ORDER[0]);
      answer.quality = Math.min(1, Math.min(faceWidth * width, faceHeight * height) / 144, blurVariance / 40);
      answer.photo_anchors = anchors;
      return finish();
    } finally { this._busy = false; finishAnalysis(); }
  }

  async dispose() {
    this.disposed = true; this.ready = false;
    this._controller?.abort();
    await this._analysisDone;
    this._landmarker?.close(); this._landmarker = null;
    if (this._session) await this._session.release();
    this._session = null;
  }
}

export class BrowserEmotionAnalyzer {
  constructor({coreFactory = () => new BrowserInferenceCore(), workerFactory = url => new Worker(url), workerSupported = inferenceWorkerSupported,
    initIdleTimeoutMs = 45000, analysisTimeoutMs = 30000} = {}) {
    this.ready = false; this.disposed = false; this._initializing = null;
    this._worker = null; this._core = null; this._pending = new Map(); this._sequence = 0;
    this._coreFactory = coreFactory; this._workerFactory = workerFactory; this._workerSupported = workerSupported;
    this._initIdleTimeoutMs = initIdleTimeoutMs; this._analysisTimeoutMs = analysisTimeoutMs;
  }

  _request(type, data = {}, transfer = [], progress = () => {}) {
    const id = ++this._sequence;
    return new Promise((resolve, reject) => {
      const expired = () => {
        this._pending.delete(id);
        reject(Object.assign(new Error('识别加载没有响应，请重试加载'), {code: 'INFERENCE_WORKER_TIMEOUT'}));
      };
      const request = {resolve, reject, timer: null, progress};
      request.keepAlive = () => { clearTimeout(request.timer); request.timer = setTimeout(expired, type === 'init' ? this._initIdleTimeoutMs : this._analysisTimeoutMs); };
      request.keepAlive();
      this._pending.set(id, request);
      try { this._worker.postMessage({id, type, ...data}, transfer); }
      catch (error) { clearTimeout(request.timer); this._pending.delete(id); reject(error); }
    });
  }

  async init(onProgress = () => {}) {
    if (this.disposed) throw new Error('识别模块已关闭，请刷新页面');
    if (this.ready) return;
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      const initCore = async () => {
        // Older browsers can run the same model on the UI thread at reduced
        // frame rate; there is no change of model or invented fallback result.
        this._core ||= this._coreFactory();
        try { await this._core.init(onProgress); }
        catch (error) { await this._core?.dispose(); this._core = null; throw error; }
      };
      if (!this._workerSupported()) {
        await initCore();
      } else {
        try {
          const worker = this._workerFactory(local('./inference-worker.js?v=20261104-mobile-model'));
          this._worker = worker;
          worker.onmessage = ({data}) => {
            if (this._worker !== worker) return;
            const request = this._pending.get(data.id);
            if (!request) return;
            if (data.type === 'progress') { request.keepAlive(); try { request.progress(data.message); } catch {} return; }
            clearTimeout(request.timer); this._pending.delete(data.id);
            if (data.type === 'error') request.reject(Object.assign(new Error(data.message), {
              name: data.name || 'Error', code: data.code, assetDownload: Boolean(data.assetDownload), inferenceRuntime: Boolean(data.inferenceRuntime),
            })); else request.resolve(data.result);
          };
          worker.onerror = () => {
            if (this._worker !== worker) return;
            this.ready = false;
            this._failPending(Object.assign(new Error('浏览器识别线程未能运行'), {code: 'INFERENCE_WORKER_CAPABILITY'}));
            worker.terminate(); this._worker = null;
          };
          await this._request('init', {}, [], onProgress);
        } catch (error) {
          this._worker?.terminate(); this._worker = null;
          if (this.disposed || error.name === 'AbortError' || error.assetDownload) throw error;
          // One compatibility fallback only. Network failures retain their
          // actionable download error instead of restarting the same work.
          try { onProgress('正在切换到兼容识别模式，模型和识别结果保持一致…'); } catch {}
          await initCore();
        }
      }
      if (this.disposed) throw new Error('识别模块已关闭');
      this.ready = true;
    })().finally(() => { this._initializing = null; });
    return this._initializing;
  }

  async analyze(image) {
    if (!this.ready) await this.init();
    if (this.disposed) throw new Error('识别模块已关闭');
    if (this._core) return this._core.analyze(image);
    const width = image.videoWidth || image.naturalWidth || image.width, height = image.videoHeight || image.naturalHeight || image.height;
    if (!width || !height || width * height > 20_000_000) throw new Error('图片尚未就绪，或尺寸超过 2000 万像素');
    const bitmap = await createImageBitmap(image);
    if (this.disposed) { bitmap.close(); throw new Error('识别模块已关闭'); }
    try { return await this._request('analyze', {image: bitmap}, [bitmap]); }
    finally { bitmap.close(); }
  }

  _failPending(error) {
    for (const request of this._pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this._pending.clear();
  }

  async dispose() {
    this.disposed = true; this.ready = false;
    this._failPending(new Error('识别模块已关闭'));
    this._worker?.terminate(); this._worker = null;
    await this._core?.dispose(); this._core = null;
  }
}
