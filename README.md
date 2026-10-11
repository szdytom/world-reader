# 世界阅读器

面向手机的 PWA。开启 Web Camera 后持续播放视频，在本机用 **`@ultralytics/yolo` + WASM** 做 YOLO11n 实例分割，把物体名称和画面方位读出来。没有拍照、上传照片或录像存储入口。

## 手机上打开

GitHub Pages：https://szdytom.github.io/world-reader/

使用手机 Safari 或 Chrome 打开，点「开启摄像头」并允许访问。首次加载需要下载模型和 WASM，完成后会缓存到手机。这个静态版本默认使用系统中文语音；GitHub Pages 不运行 Piper Python 服务。本机版本仍使用 Piper。

`npm run build:pages` 生成 `dist-pages/`，已配置 `/world-reader/` 子目录下的模型、运行时、图标和 Service Worker。GitHub Pages 发布源是 `gh-pages` 分支；源码放在 `main` 分支。静态模型也随站点发布，无需手机访问 GitHub release 的跨域下载链接。

## 黑客松 Demo

当前工作区已准备好模型、运行时、Python 依赖和 Piper 中文音色。重新启动完整 demo：

```sh
npm run demo
```

打开 http://localhost:8000，点击「开启摄像头」。默认自动朗读；也可以点击「朗读当前画面」。WASM 推理在浏览器本地运行，Piper 在本机服务合成语音。

手机演示需 HTTPS。Android 连接电脑后，也可以运行 `adb reverse tcp:8000 tcp:8000`，再在手机浏览器打开 `http://localhost:8000`。这样可使用摄像头的 localhost 安全上下文，无需临时部署 HTTPS。

需要重新下载时，可用本机 2081 HTTP 代理加速：`npm install --proxy http://127.0.0.1:2081`；下载脚本与 Python 安装可在命令前设置 `HTTPS_PROXY=http://127.0.0.1:2081`。

## 启动

需要 Node.js 22+，首次准备模型需要 `curl`。

```sh
npm install
npm run assets
npm run dev
```

打开 http://localhost:5173。允许摄像头访问后，会自动下载并初始化模型。默认使用后置镜头，可切换前置镜头。**手机访问必须使用 HTTPS**；普通局域网 HTTP 地址不能请求摄像头。可通过可信 HTTPS 反向代理或开发隧道访问 Vite。

识别不需要 Python 服务。在底部下拉框选择「系统语音」可使用设备中文音色；这不是 Piper，离线可用性取决于设备是否安装中文声音。

## Piper 中文朗读

Piper 是独立的可选语音服务，只接收中文文字，不接收视频帧。使用 Python 3.11 / 3.12：

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
.venv/bin/python backend/download_voice.py
.venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Vite 已把 `/api` 代理到 `127.0.0.1:8000`。默认中文音色是 `zh_CN-huayan-medium`；用 `PIPER_VOICE=/绝对路径/voice.onnx` 可更换音色，旁边需有 `.onnx.json` 配置。未连接服务时界面显示提示，不会把系统语音伪装成 Piper。

## 生产与 PWA

```sh
npm run assets
npm run build
.venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

构建后后端会在同一域名提供 `dist/` 和语音 API。在外层配置 HTTPS，然后通过浏览器安装至手机主屏幕。也可单独部署 `dist/`，将 `/api` 反向代理到语音服务。

- 应用外壳由 Service Worker 缓存。
- ONNX 模型在首次成功下载后写入 Cache API。
- WASM 和配套模块从同源 `/runtime/` 加载，首次使用后缓存。没有 CDN 运行时依赖。
- 完成一次模型初始化后可离线开启摄像头、分割与生成中文描述。Piper 仍需连接服务；它可在同一局域网本机运行。
- 浏览器清理缓存、隐私模式或存储不足时，可能需要重新下载模型。

## 实现

`src/vision.worker.ts` 直接使用官方 `YOLO.load` / `predict`，强制 `device: 'cpu'` 验证 WASM 路径，预处理、NMS 和掩膜都交给官方包。模型来自 Ultralytics 官方 `v8.4.0` release，使用 FP32 ONNX。`scripts/setup-assets.mjs` 准备模型和与依赖版本一致的 WASM 文件。

当前 SDK 默认 ORT 加载器通过 DOM 插入脚本，无法直接用于 Worker。`vite.config.ts` 仅替换该桥接加载器，使用同版本 `onnxruntime-web/wasm`，将 ORT 暴露给 Rust bindings；同时关闭 SDK 的域名遥测。模型处理仍然使用官方 SDK。WASM 使用单线程，不要求 COOP / COEP；运行在 Worker 里保持界面响应。

每次只处理一帧，推理完成后再取下一帧，显示实际耗时。摄像头视频持续播放，掩膜对应最近完成的推理，因此快速移动时会有延迟。切换镜头或关闭时丢弃旧结果；退到后台时停止摄像头。应用不保存帧，不录制视频。界面只有实时画面、当前描述和朗读控制，不提供记录页或设置页。

场景需稳定 1.5 秒后才自动朗读，朗读间隔至少 8 秒，相同场景不反复播报。COCO 模型支持 80 类常见物体，描述「左侧 / 中间 / 右侧」是画面方位，不推断真实距离。

## 验证

```sh
npm test
npm run build
.venv/bin/python -m pytest backend -q
# 需要 Chromium 和 ffmpeg。可省略 CHROMIUM_PATH 并使用 Playwright 安装的浏览器。
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

浏览器测试将官方公交车样例转成模拟摄像头视频，实际运行 WASM 分割，验证物体、掩膜、关闭镜头和离线重载；不使用伪造模型输出。

官方参考：[Ultralytics 浏览器 SDK](https://github.com/ultralytics/inference/tree/main/web)、[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)、[Piper Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md)、[中文音色](https://huggingface.co/rhasspy/piper-voices/tree/main/zh/zh_CN/huayan/medium)。上游 SDK / 模型采用 Ultralytics AGPL-3.0 授权，Piper 使用 GPL-3.0；中文音色的说明下载到 `models/MODEL_CARD`。
