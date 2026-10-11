# 世界阅读器

面向手机的 PWA。Web Camera 持续播放视频，浏览器内使用 **`@ultralytics/yolo` + WASM** 做 YOLO11n 实例分割，使用 **PP-OCRv6 Tiny + WASM** 识别路牌、标识等文字，通过 **Web Speech API** 自动朗读中文。整个应用为静态前端，无需后端或 Python。

## 手机上打开

GitHub Pages：https://szdytom.github.io/world-reader/

使用手机 Safari 或 Chrome 打开，点「开启摄像头」并允许访问。开启时先播报「开始观察」，随后自动阅读，无需反复点击朗读。首次需下载模型和 WASM，完成后缓存到手机。

先简述画面，之后只播报变化，例如「右侧新出现瓶子」「人从画面左侧移到中间」「左侧不再看到笔记本电脑」。画面保持不变时，每 20 秒简短更新一次。可关闭自动朗读，手动朗读当前画面。

语音优先选择设备的简体中文音色；音色及离线朗读能力取决于手机系统。识别和跟踪均在浏览器内完成，应用不上传或保存视频帧。

「读文字」默认开启，新识别的文字优先朗读，例如「中间写着『中山路』」。同一文字不会连续重复；空格、标点和长文本的少量识别抖动会去重。较低置信度文字需重复确认。黄色框表示 OCR 文字区域。可关闭「读文字」，继续进行物体识别。

## 启动

需要 Node.js 22+，首次准备模型需要 `curl` 和 `tar`。

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
- OCR 的两个模型与 OpenCV.js 也从同源加载并缓存。OCR 首次额外下载约 16 MB，其中模型约 6 MB，OpenCV 约 10 MB。
- 缓存完成后可离线开启摄像头、分割、跟踪、OCR 和生成描述。离线语音需设备安装中文音色。
- 浏览器清理缓存、隐私模式或存储不足时，可能需要重新下载模型。

## 实现

`src/vision.worker.ts` 直接使用官方 `YOLO.load` / `predict`，指定 `device: 'cpu'` 运行 WASM。预处理、NMS 和掩膜均来自官方 SDK。模型为 Ultralytics 官方 `v8.4.0` release 的 YOLO11n-seg FP32 ONNX，支持 COCO 80 类。`scripts/setup-assets.mjs` 准备模型和版本匹配的 WASM 文件。

SDK 默认 ORT 加载器通过 DOM 插入脚本，无法直接用于 Worker。`vite.config.ts` 仅替换该桥接加载器，使用 `onnxruntime-web/wasm`，将 ORT 暴露给 Rust bindings；同时关闭 SDK 的域名遥测。WASM 使用单线程，无需 COOP / COEP；Worker 保持界面响应。

每次只处理一帧，完成后取下一帧，显示实际耗时。掩膜对应最近完成的推理，快速移动时有延迟。切换镜头时重置跟踪；关闭镜头或退到后台时停止摄像头和语音。

`src/tracking.ts` 使用同类别框的 IoU 和中心距离关联跨帧目标，赋予内部 ID。目标至少两次识别且跨越 700 ms 才进入播报；容忍至少 3.5 秒短暂漏检，按慢速设备推理耗时延长；方位变化有边界滞回和 1 秒确认时间。播报比较当前跟踪结果与上次已播报的快照，朗读期间持续观察，结束后继续播报累积变化。每条最多四组变化，间隔至少 3 秒，减少语音积压；手机缺失语音结束事件时有超时恢复。

这是适合低帧率 MVP 的轻量空间跟踪，未移植 Python 的 ByteTrack / BoT-SORT。遮挡、多人交叉、快速转动镜头或误分类仍可能造成 ID 切换。方向表示画面中的「左侧 / 中间 / 右侧」，不推断真实距离或物体的实际运动。

## OCR

采用 PaddleOCR 官方 `@paddleocr/paddleocr-js@0.4.2`，使用官方 PP-OCRv6 Tiny 检测与识别 ONNX。`scripts/setup-ocr-assets.mjs` 从固定 Hugging Face revision 下载模型和字典配置，打包为 SDK 所需的未压缩 ustar 文件。模型支持中文和英文；PaddleOCR.js、模型和 OpenCV 使用 Apache-2.0。

`src/ocr.worker.ts` 在独立 Worker 中执行官方检测、透视裁剪和 CTC 识别。它与 YOLO 共用同版本的 ORT WASM 文件。桥接适配只处理 Worker 的 ImageData 输入、OpenCV 模块初始化和同源运行时路径，不重写模型算法。单线程 WASM 无需特殊响应头，可在 GitHub Pages 运行。

OCR 在 YOLO 初始化后启动，每次取一帧，最长边最多 960 像素，检测最长边最多 640 像素。每轮完成后至少等待 2.5 秒，慢设备进一步降低扫描频率。关闭文字识别、关闭镜头或切换摄像头时终止旧 Worker，丢弃旧结果；OCR 故障不关闭摄像头或 YOLO。

`src/textReader.ts` 管理文字播报：置信度低于 0.75 时忽略，低于 0.9 时至少两轮确认；同一可见文字只读一次，至少离开一分钟后重新出现才允许再次读。新文字优先于物体变化，但不会打断正在播放的语音。最多一次读三条文字，每条最多 32 字，未读条目保留到后续播报。屏幕展示当前 OCR 结果；语音显示最近播报内容。OCR 识别的是文字，不额外推断路牌图形、箭头方向或交通规则。

远处小字、模糊、反光和快速移动会影响识别；靠近标识并稍停片刻更适合演示。RapidOCR 是成熟的多引擎 OCR 工具包，RapidOCRWeb 需要 Flask 服务；此应用选择官方 PaddleOCR.js，保持纯前端部署。

## 验证

```sh
npm test
npm run build
# 需要 Chromium、ffmpeg、fontconfig 和中文字体，可省略 CHROMIUM_PATH 使用 Playwright 浏览器。
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

单元测试覆盖跨帧身份、短暂漏检、单帧误检、方位抖动、差分播报，以及 OCR 确认、去重和变化内容。浏览器测试使用公交车样例和生成的中文路牌视频，实际运行 YOLO 与 PP-OCRv6 WASM，验证物体、掩膜、中文识别、自动文字朗读、关闭功能和离线重载。语音控制测试替代操作系统发声接口，不验证实际音色。

参考：[Ultralytics 浏览器 SDK](https://github.com/ultralytics/inference/tree/main/web)、[Ultralytics 跟踪模式](https://docs.ultralytics.com/modes/track/)、[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)、[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)、[PaddleOCR 浏览器部署](https://www.paddleocr.ai/main/version3.x/inference_deployment/cross_platform/browser.html)、[PP-OCRv6](https://www.paddleocr.ai/main/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)、[RapidOCRWeb](https://github.com/RapidAI/RapidOCRWeb)。Ultralytics SDK / 模型采用 AGPL-3.0 授权。
