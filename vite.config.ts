import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH || '/';

// The SDK's default ORT loader injects a <script> into document. Adapt only
// that bridge for Workers; YOLO preprocessing, NMS and masks stay in the SDK.
const workerRuntime = () => ({
  name: 'yolo-worker-runtime', enforce: 'pre' as const,
  transform(_code: string, id: string) {
    if (!id.includes('@ultralytics/yolo') || !id.includes('/snippets/')) return;
    if (id.endsWith('/_telemetry.js')) return 'export function trackSessionInit() { return false; }';
    if (id.endsWith('/_loader.js')) return `
      import * as ort from 'onnxruntime-web/wasm';
      export async function initRuntime() {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = new URL(${JSON.stringify(`${base}runtime/ort/`)}, globalThis.location.origin).href;
        globalThis.ort = ort;
        return true;
      }
    `;
  },
});

const ocrRuntime = () => ({
  name: 'paddle-ocr-worker-runtime', enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('@paddleocr/paddleocr-js/dist/index.mjs')) return;
    const bridge = 'ensureServedFromHttp,\n      sourceToMat\n';
    if (!code.includes(bridge)) throw new Error('PaddleOCR adapter changed; review the Worker bridge.');
    return code
      .replace('import cvModule from "@techstark/opencv-js";',
        `const cvModule = import(/* @vite-ignore */ new URL(${JSON.stringify(`${base}runtime/opencv.js`)}, globalThis.location.origin).href).then(() => new Promise(resolve => {
          const cv = globalThis.cv;
          const ready = () => { delete cv.then; resolve(cv); };
          if (cv.Mat) ready(); else cv.onRuntimeInitialized = ready;
        }));`)
      .replace('import("onnxruntime-web")', 'import("onnxruntime-web/wasm")')
      .replace(bridge, 'ensureServedFromHttp,\n      sourceToMat: options.sourceToMat || sourceToMat\n')
      // We supply the app's Worker; omit the SDK's unused prebuilt Worker bundle.
      .replace(/function createDefaultWorker\(\) \{[\s\S]*?\n\}/,
        'function createDefaultWorker() { throw new Error("Use the application OCR Worker."); }');
  },
});

export default defineConfig({
  base,
  plugins: [workerRuntime(), ocrRuntime(), react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icons/*.png', 'icons/icon.svg'],
    manifest: {
      name: '世界阅读器', short_name: '世界阅读器',
      description: '用镜头认识身边的物体，听见眼前的世界。',
      lang: 'zh-CN', start_url: base, scope: base, display: 'standalone',
      background_color: '#f3f5f7', theme_color: '#f3f5f7',
      icons: [
        { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,jpg,json,wav}'],
      globIgnores: ['runtime/**', 'models/**'],
      runtimeCaching: [{
        urlPattern: new RegExp(`${base}runtime/`),
        handler: 'CacheFirst',
        options: { cacheName: 'world-reader-runtime-v1', cacheableResponse: { statuses: [200] } },
      }, {
        urlPattern: new RegExp(`${base}models/pp-ocrv6-.*\\.tar$`),
        handler: 'CacheFirst',
        options: { cacheName: 'world-reader-ocr-model-v1', cacheableResponse: { statuses: [200] } },
      }],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
  })],
  worker: { format: 'es', plugins: () => [workerRuntime(), ocrRuntime()] },
  optimizeDeps: { exclude: ['@ultralytics/yolo', '@paddleocr/paddleocr-js'] },
});
