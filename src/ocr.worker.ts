import { PaddleOCR, normalizeOcrPipelineConfig, type OcrPipelineRunnerOptions } from '@paddleocr/paddleocr-js';
import { directionFor } from './scene';
import type { TextLine } from './types';

let model: PaddleOCR | undefined;
const BASE = import.meta.env.BASE_URL;
const CACHE = 'world-reader-ocr-model-v1';

const cachedFetch: typeof fetch = async (input, init) => {
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); } catch { /* Private mode may disable storage. */ }
  const cached = await cache?.match(input);
  if (cached) return cached;
  const response = await fetch(input, init);
  if (response.ok) {
    try { await cache?.put(input, response.clone()); } catch { /* OCR still works without a cache. */ }
  }
  return response;
};

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      if (!model) {
        // Only adapt input pixels to a cv.Mat. Detection, crops and CTC use the SDK.
        const sourceToMat: NonNullable<OcrPipelineRunnerOptions['sourceToMat']> = (cv, source) => {
          const image = source as ImageData;
          const mat = cv.matFromImageData(image);
          return { width: image.width, height: image.height, mat, dispose: () => mat.delete() };
        };
        model = new PaddleOCR({
          pipelineConfig: normalizeOcrPipelineConfig({
            pipeline_name: 'OCR',
            SubModules: {
              TextDetection: { model_name: 'PP-OCRv6_tiny_det',
                model_dir: { url: new URL(`${BASE}models/pp-ocrv6-tiny-det.tar`, self.location.origin).href },
                limit_side_len: 640, limit_type: 'max', max_side_limit: 640, box_thresh: 0.55 },
              TextRecognition: { model_name: 'PP-OCRv6_tiny_rec',
                model_dir: { url: new URL(`${BASE}models/pp-ocrv6-tiny-rec.tar`, self.location.origin).href },
                batch_size: 4, score_thresh: 0.75 },
            },
          }),
          ortOptions: { backend: 'wasm', numThreads: 1, proxy: false,
            wasmPaths: new URL(`${BASE}runtime/ort/`, self.location.origin).href },
          fetch: cachedFetch, sourceToMat,
        });
        await model.initialize();
      }
      self.postMessage({ type: 'ready' });
      return;
    }
    if (data.type !== 'frame' || !model) return;
    const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
    const [result] = await model.predict(image);
    const lines: TextLine[] = result.items.map(item => {
      const xs = item.poly.map(p => p[0] / result.image.width);
      const ys = item.poly.map(p => p[1] / result.image.height);
      const box: TextLine['box'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return { text: item.text, score: item.score, box, direction: directionFor((box[0] + box[2]) / 2) };
    });
    self.postMessage({ type: 'result', generation: data.generation, result: {
      lines, width: result.image.width, height: result.image.height, elapsed: result.metrics.totalMs,
    } });
  } catch (error) {
    // OCR is optional: an OCR failure must not stop YOLO or the camera.
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
