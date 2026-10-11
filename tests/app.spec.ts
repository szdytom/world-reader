import { expect, test } from '@playwright/test';

test('single screen keeps camera and voice controls within the mobile viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.getByRole('heading', { name: '世界阅读器' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeEnabled();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByText('系统中文语音', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.getByRole('button', { name: '自动朗读', exact: true }).click();
  await expect(page.getByRole('button', { name: '自动朗读', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('narration starts on the camera tap and continues even if a voice omits its end event', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const calls: SpeechSynthesisUtterance[] = [];
    Object.assign(window, { speechCalls: calls });
    // CI has no installed OS voice. Keep the real utterance and browser events.
    window.speechSynthesis.speak = message => {
      calls.push(message);
      if (message.text === '开始观察。') setTimeout(() => message.dispatchEvent(new Event('end')), 10);
    };
  });
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  const calls = () => page.evaluate(() => (window as unknown as { speechCalls: SpeechSynthesisUtterance[] }).speechCalls.map(u => ({ text: u.text, lang: u.lang })));
  await expect.poll(async () => (await calls())[0]?.text).toBe('开始观察。');
  await expect.poll(async () => (await calls())[1]?.text, { timeout: 30000 }).toContain('公交车');
  await expect(page.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible();
  // Skip past the recovery deadline without waiting thirty real seconds.
  await page.clock.fastForward(31000);
  await page.clock.runFor(600);
  await expect.poll(async () => (await calls()).length).toBeGreaterThan(2);
  expect((await calls())[2].text).toContain('画面基本没变');
  expect((await calls()).every(u => u.lang === 'zh-CN')).toBe(true);
  // A late callback from a previous utterance cannot stop the current one.
  await page.evaluate(() => (window as unknown as { speechCalls: SpeechSynthesisUtterance[] }).speechCalls[1].dispatchEvent(new Event('end')));
  await expect(page.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭镜头' }).click();
  await expect(page.getByRole('button', { name: '开启摄像头', exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('real YOLO WASM segments live video and survives an offline reload', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://localhost:4173/') && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await page.getByRole('button', { name: '自动朗读', exact: true }).click();
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.locator('.scene-caption')).toContainText('公交车', { timeout: 30000 });
  await expect(page.locator('.scene-caption')).toContainText('人');
  await expect(page.getByRole('button', { name: '朗读当前画面' })).toBeEnabled();
  const firstFrame = await page.locator('.frame-timing').textContent();
  await expect.poll(async () => page.locator('.frame-timing').textContent()).not.toBe(firstFrame);
  expect(await page.locator('.segmentation').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, i) => i % 4 === 3 && value > 0);
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-live.png', fullPage: true });
  await page.getByRole('button', { name: '关闭镜头' }).click();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('离线', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
  await expect(page.locator('.scene-caption')).toContainText('公交车', { timeout: 30000 });
  await page.getByRole('button', { name: '关闭镜头' }).click();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
