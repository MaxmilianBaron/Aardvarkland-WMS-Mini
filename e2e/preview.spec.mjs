import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const screenshotDir = 'artifacts/ui';

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

test('desktop wrapper loads the compiled Mini app', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle(/Aardvarkland WMS-Mini/);
  const appFrame = page.frameLocator('iframe[title="Aardvarkland WMS-Mini"]');
  await expect(appFrame.locator('#root > *').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${screenshotDir}/01-mini-desktop-frame.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  await page.close();
});

test('mobile entry redirects to the full-screen compiled app', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${screenshotDir}/02-mini-mobile-app.png` });

  expect(pageErrors).toEqual([]);
  await page.close();
});
