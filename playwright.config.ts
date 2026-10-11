import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  testDir: './tests', timeout: 120000, fullyParallel: false, workers: 1,
  use: {
    baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 },
    permissions: ['camera'], trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(os.tmpdir(), 'world-reader-camera.y4m')}`],
    },
  },
  webServer: { command: 'npm run preview -- --port 4173', port: 4173, reuseExistingServer: !process.env.CI },
});
