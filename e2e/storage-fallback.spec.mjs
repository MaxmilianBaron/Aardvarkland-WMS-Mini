import { test, expect } from '@playwright/test';

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('standalone Mini remains usable when browser localStorage is unavailable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage access is blocked', 'SecurityError');
      },
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}app/?source-parity=1`, { waitUntil: 'networkidle' });
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Warehouse overview', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', /en/);

  await page.locator('.language-switch').click();
  await expect(page.locator('.language-menu__list')).toBeVisible();
  await page.locator('.language-menu__list button[data-language-code="fr"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', /fr/);

  await page.locator('.theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(pageErrors).toEqual([]);

  await context.close();
});
