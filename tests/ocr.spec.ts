import { expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

test.use({ launchOptions: {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.join(os.tmpdir(), 'world-reader-sign.y4m')}`],
} });

test.describe('slow text model preparation', () => {
  // Serve the models without the service worker so the route delay below is
  // always the request the page makes, on any machine and cache state.
  test.use({ serviceWorkers: 'block' });

  test('does not announce missing objects before the first OCR pass returns', async ({ page }) => {
    const spoken = () => page.evaluate(() => (window as unknown as { speechCalls: string[] }).speechCalls);
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, { speechCalls: calls });
      speechSynthesis.speak = message => {
        calls.push(message.text);
        setTimeout(() => message.dispatchEvent(new Event('end')), 50);
      };
    });
    // On a phone the first OCR visit downloads roughly 16 MB of models and
    // runtime. Delay the sign models so preparation outlasts the scene
    // reader's two-second grace window, exactly as it does on a real device.
    await page.route('**/models/pp-ocrv6-*.tar', async route => {
      await new Promise(resolve => setTimeout(resolve, 6000));
      await route.continue();
    });
    await page.goto('/');
    await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
    // The fixture is a road sign: YOLO finds no COCO object, so "no objects"
    // would be the only thing the scene reader could say while OCR prepares.
    await expect(page.locator('.frame-timing')).toContainText('0 个物体', { timeout: 30000 });
    await page.waitForTimeout(3500);
    expect((await spoken()).filter(t => t.includes('暂时没有识别到'))).toEqual([]);
    // The sign wins over the "move the camera" prompt once the model is ready.
    await expect.poll(async () => (await spoken()).some(t => t.includes('中山路')), { timeout: 60000 }).toBe(true);
    expect((await spoken()).filter(t => t.includes('暂时没有识别到'))).toEqual([]);
    expect((await spoken())[0]).toBe('开始观察。');
    await page.getByRole('button', { name: '关闭镜头' }).click();
  });
});

test('real PP-OCRv6 reads Chinese video text, deduplicates speech, and works offline', async ({ page, context }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://localhost:4173/') && !request.url().startsWith('blob:')) external.push(request.url());
  });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { speechCalls: calls });
    speechSynthesis.speak = message => {
      calls.push(message.text);
      setTimeout(() => message.dispatchEvent(new Event('end')), 50);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.locator('.ocr-caption')).toContainText('中山路', { timeout: 60000 });
  await expect(page.locator('.ocr-caption')).toContainText('禁止停车');
  const spoken = () => page.evaluate(() => (window as unknown as { speechCalls: string[] }).speechCalls);
  await expect.poll(async () => (await spoken()).some(t => t.includes('读到文字') && t.includes('中山路'))).toBe(true);
  await expect.poll(async () => (await spoken()).some(t => t.includes('禁止停车'))).toBe(true);
  // Another real OCR pass must not repeat the same sign.
  await page.waitForTimeout(5000);
  expect((await spoken()).filter(t => t.includes('中山路'))).toHaveLength(1);
  expect((await spoken()).some(t => t.includes('暂时没有识别到'))).toBe(false);
  await expect(page.locator('.scene-caption')).toContainText('读到文字');
  await page.screenshot({ path: 'test-results/mobile-ocr.png', fullPage: true });
  await page.getByRole('button', { name: '关闭镜头' }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.locator('.ocr-caption')).toContainText('中山路', { timeout: 60000 });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.locator('.ocr-caption')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '读取文字', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '关闭镜头' }).click();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
