import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const models = path.join(root, 'public/models');
const runtime = path.join(root, 'public/runtime');
await mkdir(models, { recursive: true });
await mkdir(runtime, { recursive: true });

// OpenCV's UMD wrapper uses `this` as its root; ES module workers need globalThis.
const cv = await readFile(path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'), 'utf8');
if (!cv.includes('}(this, function () {')) throw new Error('OpenCV wrapper changed; review the worker adapter.');
await writeFile(path.join(runtime, 'opencv.js'), cv.replace('}(this, function () {', '}(globalThis, function () {'));

const revisions = {
  det: '2ba1506c0380b8f0b03dd142459aac66d4421f6c',
  rec: '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30',
};
await Promise.all(Object.entries(revisions).map(async ([role, revision]) => {
  const target = path.join(models, `pp-ocrv6-tiny-${role}.tar`);
  if ((await stat(target).catch(() => null))?.size) return;
  const temporary = await mkdtemp(path.join(tmpdir(), `world-reader-ocr-${role}-`));
  const url = `https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_${role}_onnx/resolve/${revision}`;
  console.log(`下载官方 PP-OCRv6 Tiny ${role} 模型…`);
  try {
    await Promise.all(['inference.onnx', 'inference.yml'].map(file => run('curl', [
      '-fL', '--retry', '3', '--retry-all-errors', '--connect-timeout', '30',
      '--silent', '--show-error', `${url}/${file}`, '-o', path.join(temporary, file),
    ])));
    await run('tar', ['--format=ustar', '-cf', target + '.part', '-C', temporary, 'inference.onnx', 'inference.yml']);
    await rename(target + '.part', target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(target + '.part', { force: true });
  }
}));
await writeFile(path.join(models, 'pp-ocrv6-NOTICE.txt'),
  'PP-OCRv6 Tiny detection and recognition models: PaddlePaddle Authors, Apache-2.0.\n' +
  'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx\n' +
  'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx\n');
console.log('PP-OCRv6 模型和 OpenCV 运行时已准备好。');
