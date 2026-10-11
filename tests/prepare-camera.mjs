import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const input = path.join(os.tmpdir(), 'world-reader-bus.jpg');
if (!existsSync(input)) execFileSync('curl', ['-fL', '--retry', '2', 'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg', '-o', input], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', input, '-vf', 'scale=360:480,pad=640:480:140:0', '-r', '5', '-t', '2', '-pix_fmt', 'yuv420p', path.join(os.tmpdir(), 'world-reader-camera.y4m')], { stdio: 'inherit' });

// A readable Chinese road-sign fixture, processed by the real PP-OCRv6 model.
const font = execFileSync('fc-match', ['-f', '%{file}', 'sans:lang=zh'], { encoding: 'utf8' }).trim();
const filters = [
  'drawbox=x=100:y=100:w=760:h=230:color=0x15519c:t=fill',
  `drawtext=fontfile='${font}':text='中山路':fontsize=80:fontcolor=white:x=(w-tw)/2:y=125`,
  `drawtext=fontfile='${font}':text='Zhongshan Road':fontsize=40:fontcolor=white:x=(w-tw)/2:y=250`,
  'drawbox=x=200:y=400:w=560:h=160:color=white:t=fill',
  `drawtext=fontfile='${font}':text='禁止停车':fontsize=64:fontcolor=black:x=(w-tw)/2:y=430`,
].join(',');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xe4e7e9:s=960x720',
  '-vf', filters, '-r', '5', '-t', '2', '-pix_fmt', 'yuv420p', path.join(os.tmpdir(), 'world-reader-sign.y4m')], { stdio: 'inherit' });
