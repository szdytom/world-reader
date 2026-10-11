import { YOLO } from '@ultralytics/yolo';
import { directionFor, labels } from './scene';
import type { Detection } from './types';

let model: YOLO | undefined;
const BASE = import.meta.env.BASE_URL;
const MODEL_URL = `${BASE}models/yolo11n-seg.onnx`;
const CACHE = 'world-reader-model-v1';

async function loadModel() {
  if (model) { self.postMessage({ type: 'ready', device: model.device }); return; }
  self.postMessage({ type: 'progress', progress: 0, stage: '正在加载识别模型' });
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); } catch { /* Private browsing can disable Cache API. */ }
  const cached = await cache?.match(MODEL_URL);
  let bytes: ArrayBuffer;
  if (cached) {
    bytes = await cached.arrayBuffer();
  } else {
    const response = await fetch(MODEL_URL);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('识别模型尚未准备好，请先在项目中运行 npm run assets。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('浏览器无法读取模型，请使用新版浏览器。');
    const size = Number(response.headers.get('content-length'));
    const chunks: Uint8Array[] = []; let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      self.postMessage({ type: 'progress', progress: size ? Math.min(95, Math.round(received / size * 95)) : 0, stage: '正在下载识别模型' });
    }
    const joined = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    bytes = joined.buffer;
    try { await cache?.put(MODEL_URL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* Inference still works without persistent cache. */ }
  }
  self.postMessage({ type: 'progress', progress: 98, stage: '正在启动 WASM 引擎' });
  model = await YOLO.load(bytes, {
    device: 'cpu',
    wasmUrl: new URL(`${BASE}runtime/ultralytics_inference_web_bg.wasm`, self.location.origin),
    ortBaseUrl: new URL(`${BASE}runtime/ort/`, self.location.origin).href,
  });
  if (model.task !== 'segment') { model.free(); model = undefined; throw new Error('需要实例分割模型，请检查模型文件。'); }
  self.postMessage({ type: 'ready', device: model.device });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') { await loadModel(); return; }
    if (data.type !== 'frame' || !model) return;
    const start = performance.now();
    // ImageData takes the package's raw-pixel path and is safe in a Web Worker.
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const result = await model.predict(image, { conf: data.confidence, iou: 0.5 });
    const detections: Detection[] = result.boxes.map(b => ({
      name: b.name, label: labels[b.cls] ?? b.name, confidence: b.conf, color: b.color,
      box: [b.x1 / result.width, b.y1 / result.height, b.x2 / result.width, b.y2 / result.height],
      direction: directionFor((b.x1 + b.x2) / 2 / result.width),
    }));
    // Copy out of the Rust heap before transferring ownership.
    const masks = new Uint8Array(result.masks);
    self.postMessage({ type: 'result', generation: data.generation, result: {
      detections, masks, width: result.width, height: result.height,
      elapsed: performance.now() - start, inference: result.speed.inference,
    } }, { transfer: [masks.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
