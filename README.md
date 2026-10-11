# 世界阅读器

面向手机的 PWA。Web Camera 持续播放视频，浏览器内使用 **`@ultralytics/yolo` + WASM** 做 YOLO11n 实例分割，通过 **Web Speech API** 自动朗读中文。整个应用为静态前端，无需语音后端或 Python。

## 手机上打开

GitHub Pages：https://szdytom.github.io/world-reader/

使用手机 Safari 或 Chrome 打开，点「开启摄像头」并允许访问。开启时先播报「开始观察」，随后自动阅读，无需反复点击朗读。首次需下载模型和 WASM，完成后缓存到手机。

先简述画面，之后只播报变化，例如「右侧新出现瓶子」「人从画面左侧移到中间」「左侧不再看到笔记本电脑」。画面保持不变时，每 20 秒简短更新一次。可关闭自动朗读，手动朗读当前画面。

语音优先选择设备的简体中文音色；音色及离线朗读能力取决于手机系统。识别和跟踪均在浏览器内完成，应用不上传或保存视频帧。

## 启动

需要 Node.js 22+，首次准备模型需要 `curl`。

```sh
npm install
npm run assets
npm run dev
```

开发地址：http://localhost:5173。已准备模型时，运行完整构建的 demo：

```sh
npm run demo
```

打开 http://localhost:8000。默认后置镜头，可切换前置镜头。手机摄像头需要 HTTPS；普通局域网 HTTP 地址不能请求摄像头。手机演示直接使用上方 Pages 地址。Android USB 连接电脑时，也可运行 `adb reverse tcp:8000 tcp:8000`，在手机浏览器访问 `http://localhost:8000`。

本机 2081 HTTP 代理可用于加速：`npm install --proxy http://127.0.0.1:2081`；资产下载时可设置 `HTTPS_PROXY=http://127.0.0.1:2081 npm run assets`。

## 构建与 PWA

```sh
npm run build        # dist/，用于站点根路径
npm run build:pages  # dist-pages/，用于 /world-reader/ 子目录
```

把构建目录部署到 HTTPS 静态托管即可，通过浏览器添加到手机主屏幕。GitHub Pages 发布源是 `gh-pages` 分支；源码放在 `main` 分支。模型、WASM、图标和 Service Worker 都支持子目录路径。

- 应用外壳由 Service Worker 缓存。
- ONNX 模型首次成功下载后写入 Cache API。
- WASM 和配套模块从同源 `runtime/` 加载，首次使用后缓存，无 CDN 运行时依赖。
- 缓存完成后可离线开启摄像头、分割、跟踪和生成描述。离线语音需设备安装中文音色。
- 浏览器清理缓存、隐私模式或存储不足时，可能需要重新下载模型。

## 实现

`src/vision.worker.ts` 直接使用官方 `YOLO.load` / `predict`，指定 `device: 'cpu'` 运行 WASM。预处理、NMS 和掩膜均来自官方 SDK。模型为 Ultralytics 官方 `v8.4.0` release 的 YOLO11n-seg FP32 ONNX，支持 COCO 80 类。`scripts/setup-assets.mjs` 准备模型和版本匹配的 WASM 文件。

SDK 默认 ORT 加载器通过 DOM 插入脚本，无法直接用于 Worker。`vite.config.ts` 仅替换该桥接加载器，使用 `onnxruntime-web/wasm`，将 ORT 暴露给 Rust bindings；同时关闭 SDK 的域名遥测。WASM 使用单线程，无需 COOP / COEP；Worker 保持界面响应。

每次只处理一帧，完成后取下一帧，显示实际耗时。掩膜对应最近完成的推理，快速移动时有延迟。切换镜头时重置跟踪；关闭镜头或退到后台时停止摄像头和语音。

`src/tracking.ts` 使用同类别框的 IoU 和中心距离关联跨帧目标，赋予内部 ID。目标至少两次识别且跨越 700 ms 才进入播报；容忍至少 3.5 秒短暂漏检，按慢速设备推理耗时延长；方位变化有边界滞回和 1 秒确认时间。播报比较当前跟踪结果与上次已播报的快照，朗读期间持续观察，结束后继续播报累积变化。每条最多四组变化，间隔至少 3 秒，减少语音积压；手机缺失语音结束事件时有超时恢复。

这是适合低帧率 MVP 的轻量空间跟踪，未移植 Python 的 ByteTrack / BoT-SORT。遮挡、多人交叉、快速转动镜头或误分类仍可能造成 ID 切换。方向表示画面中的「左侧 / 中间 / 右侧」，不推断真实距离或物体的实际运动。

## 验证

```sh
npm test
npm run build
# 需要 Chromium 和 ffmpeg，可省略 CHROMIUM_PATH 使用 Playwright 浏览器。
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

单元测试覆盖跨帧身份、短暂漏检、单帧误检、方位抖动、差分播报和持续更新。浏览器测试将官方公交车样例转为模拟摄像头视频，实际运行 WASM，验证物体、掩膜、关闭镜头和离线重载。语音控制测试替代操作系统发声接口，验证自动播报与缺失结束事件后的恢复，不验证实际音色。

参考：[Ultralytics 浏览器 SDK](https://github.com/ultralytics/inference/tree/main/web)、[Ultralytics 跟踪模式](https://docs.ultralytics.com/modes/track/)、[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)、[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)。上游 SDK / 模型采用 Ultralytics AGPL-3.0 授权。
