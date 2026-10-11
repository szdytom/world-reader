import { copyFile, mkdir, stat, rename, unlink, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'public/runtime');
await mkdir(path.join(runtime, 'ort'), { recursive: true });
await mkdir(path.join(root, 'public/models'), { recursive: true });
await copyFile(path.join(root, 'node_modules/@ultralytics/yolo/pkg/ultralytics_inference_web_bg.wasm'), path.join(runtime, 'ultralytics_inference_web_bg.wasm'));
const ort = path.join(root, 'node_modules/onnxruntime-web/dist');
const cpuFiles = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
for (const file of await readdir(path.join(runtime, 'ort'))) {
  if (file.startsWith('ort-wasm-simd-threaded') && !cpuFiles.includes(file))
    await unlink(path.join(runtime, 'ort', file));
}
for (const file of cpuFiles)
  await copyFile(path.join(ort, file), path.join(runtime, 'ort', file));
const model = path.join(root, 'public/models/yolo11n-seg.onnx');
if (!(await stat(model).catch(() => null))?.size) {
  console.log('下载官方 YOLO11n 实例分割 ONNX 模型…');
  const temporary = model + '.part';
  try {
    // curl also respects the developer's existing HTTP(S) proxy configuration.
    execFileSync('curl', ['-fL', '--retry', '2', '--connect-timeout', '30', 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n-seg.onnx', '-o', temporary], { stdio: 'inherit' });
    await rename(temporary, model);
  } finally { await unlink(temporary).catch(() => {}); }
}
console.log('模型与 WASM 运行时已准备好；全部从应用同源加载。');
