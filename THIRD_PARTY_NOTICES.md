# 素材与依赖说明

核验日期：2026-10-28。下述许可证各自适用于对应的第三方文件，不将整站或模型权重一并重新授权。

| 组件 | 来源 / 固定版本 | 许可与记录 |
|---|---|---|
| Three.js 与 OrbitControls | Three.js r180，提交 `0af9729d0c143a86a1d725d6e2c3ad83301f3f34` | MIT，Copyright 2010–2025 three.js authors；[许可证](static/vendor/three/LICENSE) |
| 雕塑面罩与表情形态 | [FaceCapCustomAvatarExporter / Example.FCA](https://github.com/hizzlehoff/FaceCapCustomAvatarExporter)，提交 `86a89d247624e7b5e393e4336709e490db717382` | MIT，Copyright (c) 2020 Niels J.；[许可证](static/models/sculpture-head-LICENSE.txt)、[来源与修改](static/models/sculpture-head-README.md) |
| meshoptimizer 解码器 | 0.22，随原供应商目录保留，运行时三维脸不使用 | MIT；[许可证](static/vendor/three/MESHOPT-LICENSE) |
| 管弦乐录音 | [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/)，提交 `6dd651d55dde97fd4028699be9d4481f26917891` | CC0-1.0；[许可证](static/audio/orchestra/LICENSE-VSCO-2-CE.txt)、[来源与处理](static/audio/orchestra/README.md) |
| ONNX Runtime Web | `onnxruntime-web@1.22.0`，WASM-only | MIT，Copyright Microsoft Corporation；[许可证](static/vendor/ort/LICENSE)、[第三方说明](static/vendor/ort/ThirdPartyNotices.txt) |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision@0.10.21` | Apache-2.0；[许可证](static/vendor/mediapipe/LICENSE) |
| Face Landmarker 模型 | Google `float16/1`，模型原样保留 | Apache-2.0；[来源、官方模型卡与许可](static/inference-models/SOURCES.md) |
| Anatomy 几何工具 | 2026-10-28 从已安装 Anatomy 技能复制的构建工具（iso-kit、lathe、tube、audit） | MIT，Copyright (c) 2026 Ryan；[许可证](scripts/vendor/anatomy/LICENSE)。仅构建时使用，运行时加载本站生成的 SVG |
| 表情分类 B0 | EmotiEffLib `enet_b0_8_best_afew`，固定作者提交，点击识别后从原始地址下载 | 本仓库不包含该 ONNX 权重、不重新授权权重；[来源、SHA-256 与条件](static/inference-models/SOURCES.md) |

管弦录音由 Sam Gossner、Simon Dalzell 等贡献，切片与处理署名见原项目和本地 provenance；本网站的 38 个片段保留原录音起音，处理循环、音量与淡化以适合实时声景。

在线版雕塑面罩来自 Face Cap 作者明确采用 MIT 的示例仓库，转换并细分后保留 43 个表情形态；没有使用本地早期 Demo 中来源不同的 FaceCap GLB。网站不包含真实观众照片；测试中使用的公开照片未打包或提交。

照片和分数不上传、不持久化。模型下载请求只获取运行库或模型，实际输入在浏览器内处理。GitHub Pages 会按照 GitHub 自身政策处理普通网站访问日志。
