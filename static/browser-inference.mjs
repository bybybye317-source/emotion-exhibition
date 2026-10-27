// Browser-only adaptation of the archived Python pipeline. No input image is
// sent to a server. The classifier is fetched from its original pinned source;
// model weights are not redistributed in this website repository.
export const CLASS_ORDER = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise'];
export const MODEL_SOURCE = Object.freeze({
  name: 'enet_b0_8_best_afew',
  url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx',
  bytes: 16039595,
  sha256: '7aa2ea31c1311f4f8aa9d3fdb085d418dd4e7a48c4b9ed41df8c044f91d0213f',
});
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
const local = path => new URL(path, import.meta.url).href;
const createCanvas = (width, height) => typeof OffscreenCanvas === 'function'
  ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), {width, height});

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

async function fetchClassifier(onProgress) {
  onProgress('正在下载表情模型（约 16 MB，来自作者原始仓库）…');
  const response = await fetch(MODEL_SOURCE.url, {signal: AbortSignal.timeout(120000), credentials: 'omit'});
  if (!response.ok) throw new Error(`表情模型下载失败（${response.status}），请稍后重试`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== MODEL_SOURCE.bytes) throw new Error('表情模型大小不符，请重新加载');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (checksum !== MODEL_SOURCE.sha256) throw new Error('表情模型校验失败，请重新加载');
  return bytes;
}

// Kept exported for the dedicated worker. The UI uses BrowserEmotionAnalyzer.
export class BrowserInferenceCore {
  constructor() {
    this.ready = false; this.disposed = false; this._initializing = null; this._busy = false;
    this._landmarker = null; this._session = null; this._ort = null;
    this._frame = createCanvas(1, 1); this._detection = createCanvas(1, 1);
    this._crop = createCanvas(224, 224); this._quality = createCanvas(128, 128);
  }

  async init(onProgress = () => {}) {
    if (this.disposed) throw new Error('识别模块已关闭，请刷新页面');
    if (this.ready) return;
    if (this._initializing) return this._initializing;
    const progress = message => { try { onProgress(message); } catch {} };
    this._initializing = (async () => {
      let landmarker = null, session = null;
      try {
        progress('正在载入浏览器本地识别组件…');
        const [ort, vision] = await Promise.all([
          import('./vendor/ort/ort.wasm.min.mjs'), import('./vendor/mediapipe/vision_bundle.mjs'),
        ]);
        // Pages cannot set cross-origin isolation headers. One WASM thread
        // deliberately avoids SharedArrayBuffer and COOP/COEP requirements.
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = local('./vendor/ort/');
        progress('正在准备人脸定位模型…');
        const fileset = await vision.FilesetResolver.forVisionTasks(local('./vendor/mediapipe/wasm'));
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {modelAssetPath: local('./inference-models/face_landmarker.task'), delegate: 'CPU'},
          runningMode: 'IMAGE', numFaces: 2,
          minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5,
          outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        });
        const bytes = await fetchClassifier(progress);
        if (this.disposed) throw new Error('识别模块已关闭');
        progress('正在初始化表情模型，第一次可能需要几秒…');
        session = await ort.InferenceSession.create(bytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
        if (this.disposed) throw new Error('识别模块已关闭');
        this._ort = ort; this._landmarker = landmarker; this._session = session; this.ready = true;
        progress('模型就绪 · 图像只在当前浏览器内处理');
      } catch (error) {
        landmarker?.close();
        if (session) await session.release();
        throw error;
      }
    })().finally(() => { this._initializing = null; });
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
    await this._analysisDone;
    this._landmarker?.close(); this._landmarker = null;
    if (this._session) await this._session.release();
    this._session = null;
  }
}

export class BrowserEmotionAnalyzer {
  constructor() {
    this.ready = false; this.disposed = false; this._initializing = null;
    this._worker = null; this._core = null; this._pending = new Map(); this._sequence = 0;
  }

  _request(type, data = {}, transfer = [], progress = () => {}) {
    const id = ++this._sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('识别处理超时，请刷新后重试'));
      }, type === 'init' ? 180000 : 30000);
      this._pending.set(id, {resolve, reject, timer, progress});
      try { this._worker.postMessage({id, type, ...data}, transfer); }
      catch (error) { clearTimeout(timer); this._pending.delete(id); reject(error); }
    });
  }

  async init(onProgress = () => {}) {
    if (this.disposed) throw new Error('识别模块已关闭，请刷新页面');
    if (this.ready) return;
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
        // Older browsers can run the same model on the UI thread at reduced
        // frame rate; there is no change of model or invented fallback result.
        this._core ||= new BrowserInferenceCore();
        await this._core.init(onProgress);
      } else {
        this._worker = new Worker(local('./inference-worker.js?v=20261028-anatomy'));
        this._worker.onmessage = ({data}) => {
          const request = this._pending.get(data.id);
          if (!request) return;
          if (data.type === 'progress') { try { request.progress(data.message); } catch {} return; }
          clearTimeout(request.timer); this._pending.delete(data.id);
          if (data.type === 'error') request.reject(new Error(data.message)); else request.resolve(data.result);
        };
        this._worker.onerror = () => {
          this.ready = false;
          this._failPending(new Error('浏览器识别线程未能运行，请刷新或换用新版浏览器'));
          this._worker?.terminate(); this._worker = null;
        };
        try { await this._request('init', {}, [], onProgress); }
        catch (error) { this._worker?.terminate(); this._worker = null; throw error; }
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
