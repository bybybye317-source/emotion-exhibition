# 浏览器识别组件与模型来源

核验日期：2026-10-26。所有图像处理和推断都在访问者自己的浏览器内执行；没有上传图像或分数的 API。

## 表情分类模型：原作者地址下载，不随本站分发权重

- EmotiEffLib `enet_b0_8_best_afew.onnx`，来源提交 `520a051c64cd191521e5934655314e769a319684`。
- [原始下载地址](https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx)
- 大小 16,039,595 字节，SHA256 `7aa2ea31c1311f4f8aa9d3fdb085d418dd4e7a48c4b9ed41df8c044f91d0213f`。
- 首次初始化时，浏览器从上述原始地址下载并检查大小及 SHA256，再传给本地 WASM。该请求只下载模型，不携带用户图像。原地址不可访问时会明确报错；三板块情绪预览仍可用。
- [作者 README](https://github.com/sb-ai-lab/EmotiEffLib/tree/520a051c64cd191521e5934655314e769a319684) 的 License 段明确将“code”授权为 Apache-2.0，未单独说明权重许可。因此本仓库不重新分发 ONNX 权重，也不将这些权重重新授权。`LICENSE-EMOTIEFFLIB-CODE` 仅为原代码许可证记录。
- 研究引用：Andrey Savchenko, *Facial Expression Recognition with Adaptive Frame Rate based on Multiple Testing Correction*, ICML 2023, https://proceedings.mlr.press/v202/savchenko23a.html。

固定类别顺序：anger、contempt、disgust、fear、happiness、neutral、sadness、surprise。RGB 裁剪缩放到 224×224，除 255 后按 ImageNet mean `[.485,.456,.406]` 和 std `[.229,.224,.225]` 标准化，NCHW float32，最后对八类 logits 做稳定 softmax。浏览器 Canvas 的缩放和清晰度检查与 Python OpenCV 版本可能存在数值差异，不承诺逐位一致。

## 人脸定位模型：MediaPipe Face Landmarker

- 文件 `face_landmarker.task` 原样复制自 Google [固定 float16/1 版本](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)。
- 大小 3,758,596 字节，SHA256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`。
- 三个组成模型的官方 Model Cards 均列出 Apache License Version 2.0；保留 `LICENSE-MEDIAPIPE`，未修改权重。
- [BlazeFace model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)
- [Face Mesh V2 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)
- [Blendshape model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)
- 使用 CPU delegate、IMAGE 模式、最多检测 2 张脸；无脸、多脸、过小、严重倾斜或明显模糊时不输出情绪分数。

## 固定运行库

- `../vendor/ort/`：npm `onnxruntime-web@1.22.0` 的 WASM-only ESM、WASM 加载器与二进制。保留 MIT `LICENSE` 和 `ThirdPartyNotices.txt`。显式单线程，不需要 COOP/COEP 或 SharedArrayBuffer。
- `../vendor/mediapipe/`：npm `@mediapipe/tasks-vision@0.10.21`，保留 Apache-2.0 `LICENSE`，包含 SIMD 和非 SIMD WASM。
- 两个 npm 压缩包均校验 registry 返回的 SHA512 integrity，版本和来源保存在对应目录的 `package-source.json`。本站仅复制运行所需文件，均未修改。
- [ONNX Runtime Web 环境选项](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [Google Web API 指南](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)

## 模块接口和边界

```js
const analyzer = new BrowserEmotionAnalyzer();
await analyzer.init(message => console.log(message)); // 用户点击后调用
const result = await analyzer.analyze(canvasOrVideoOrImage);
await analyzer.dispose();
```

`photo_anchors` 和 `face_box` 均采用输入完整图像的归一化坐标。没有身份识别功能。表情标签是外观分类，不代表对内心情绪的测量；预处理和质量门槛为作品原型的经验设置。

支持 Worker、OffscreenCanvas 和 createImageBitmap 的浏览器在独立 Worker 中串行推断，避免阻塞音乐调度与三维界面。摄像头末帧与图片测试若同时到达，会依次处理；图像位图在完成后释放。缺少这些能力的旧浏览器使用同一模型在主线程运行，调用方应降低采样频率并避免并发分析。低性能设备首次加载和推断可能更慢，运行错误不会悄悄降级成伪造情绪。

已在 Chromium 141 验证普通 HTTP 子路径且 `crossOriginIsolated=false` 的独立 Worker 路径：公共 Google portrait 测试图得到 happiness 为最大项，空白图不输出分数，双人图拒绝分类。测试素材只保存在系统临时目录，不包含在网站中。
