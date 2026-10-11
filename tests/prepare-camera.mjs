import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const input = path.join(os.tmpdir(), 'world-reader-bus.jpg');
if (!existsSync(input)) execFileSync('curl', ['-fL', '--retry', '2', 'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg', '-o', input], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', input, '-vf', 'scale=360:480,pad=640:480:140:0', '-r', '5', '-t', '2', '-pix_fmt', 'yuv420p', path.join(os.tmpdir(), 'world-reader-camera.y4m')], { stdio: 'inherit' });
