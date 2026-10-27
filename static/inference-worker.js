// Classic worker preserves importScripts for MediaPipe's WASM loader. Model
// inference remains off the audio scheduler/UI thread on supporting browsers.
let analyzer = null;
let initializing = null;
let analysisQueue = Promise.resolve();
self.onmessage = async ({data}) => {
  const {id, type} = data;
  try {
    if (type === 'init') {
      if (!initializing) initializing = (async () => {
        const {BrowserInferenceCore} = await import('./browser-inference.mjs?v=20261028-anatomy');
        analyzer = new BrowserInferenceCore();
        await analyzer.init(message => self.postMessage({id, type: 'progress', message}));
      })();
      await initializing;
      self.postMessage({id, type: 'result', result: {ready: true}});
    } else if (type === 'analyze') {
      if (!analyzer?.ready) throw new Error('识别模型尚未就绪');
      // A final camera frame may still be finishing when an image test starts.
      // Drain it before analyzing the next transferred frame, with no overlap.
      const pending = analysisQueue.then(() => analyzer.analyze(data.image));
      analysisQueue = pending.catch(() => {});
      const result = await pending;
      self.postMessage({id, type: 'result', result});
    } else throw new Error('不支持的识别操作');
  } catch (error) {
    self.postMessage({id, type: 'error', message: error?.message || '识别失败'});
  } finally {
    data.image?.close();
  }
};
