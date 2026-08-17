import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const screenshotDir = 'artifacts/ui';
const languageFlags = [
  { code: 'cs', file: 'cz.svg', label: 'Čeština' },
  { code: 'en', file: 'gb.svg', label: 'English' },
  { code: 'ua', file: 'ua.svg', label: 'Українська' },
  { code: 'fr', file: 'fr.svg', label: 'Français' },
  { code: 'de', file: 'de.svg', label: 'Deutsch' },
  { code: 'es', file: 'es.svg', label: 'Español' },
];

test.beforeAll(() => mkdirSync(screenshotDir, { recursive: true }));
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

async function assertEnglishWrapper(page) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Aardvarkland WMS-Mini · mobile preview');
  await expect(page.getByText('WMS-Mini · mobile preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open standalone' })).toBeVisible();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('mobilní preview');
  expect(bodyText).not.toContain('Otevřít samostatně');
  const box = await page.locator('iframe[title="Aardvarkland WMS-Mini"]').boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  expect(Math.round(box?.height ?? 0)).toBe(844);
}

async function computedBackground(locator, pseudo = null) {
  return locator.evaluate((element, pseudoElement) => (
    window.getComputedStyle(element, pseudoElement).backgroundImage
  ), pseudo);
}

async function assertRealLanguageFlags(app, screenshotPage) {
  const trigger = app.locator('.language-switch');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('data-language-code', 'en');
  await expect(trigger.locator('svg')).toHaveCSS('display', 'none');
  expect(await computedBackground(trigger, '::after')).toContain('/icons/flags/gb.svg');

  await trigger.click();
  const menu = app.locator('.language-menu__list');
  await expect(menu).toBeVisible();
  const buttons = menu.locator('button');
  await expect(buttons).toHaveCount(languageFlags.length);

  for (let index = 0; index < languageFlags.length; index += 1) {
    const expected = languageFlags[index];
    const button = buttons.nth(index);
    await expect(button).toHaveAttribute('data-language-code', expected.code);
    await expect(button).toContainText(expected.label);
    const visual = button.locator('.language-flag-image');
    await expect(visual).toBeVisible();
    await expect(visual).toHaveAttribute('aria-hidden', 'true');
    await expect(visual).toHaveCSS('font-size', '0px');
    expect(await computedBackground(visual)).toContain(`/icons/flags/${expected.file}`);
  }

  if (screenshotPage) {
    await screenshotPage.screenshot({ path: `${screenshotDir}/02-mini-language-flags.png`, fullPage: true });
  }

  await buttons.nth(3).click();
  await expect(app.locator('html')).toHaveAttribute('lang', /fr/);
  await expect(trigger).toHaveAttribute('data-language-code', 'fr');
  expect(await computedBackground(trigger, '::after')).toContain('/icons/flags/fr.svg');

  await trigger.click();
  await app.locator('.language-menu__list button[data-language-code="en"]').click();
  await expect(app.locator('html')).toHaveAttribute('lang', /en/);
  await expect(trigger).toHaveAttribute('data-language-code', 'en');
  expect(await computedBackground(trigger, '::after')).toContain('/icons/flags/gb.svg');
}

async function assertMobileSourceGeometry(app) {
  await expect(app.locator('.app-shell')).toHaveCSS('grid-template-columns', /.+/);
  const appRows = await app.locator('.app-shell').evaluate((element) => getComputedStyle(element).gridTemplateRows);
  expect(Math.round(Number.parseFloat(appRows.split(' ')[0]))).toBe(68);

  await expect(app.locator('.topbar')).toHaveCSS('position', 'sticky');
  await expect(app.locator('.topbar')).toHaveCSS('padding-left', '14px');
  await expect(app.locator('.brand-mark')).toHaveCSS('width', '44px');
  await expect(app.locator('.brand-mark img')).toHaveCSS('width', '34px');
  await expect(app.locator('.sidebar')).toBeHidden();

  const mobileNav = app.locator('.mobile-nav');
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav).toHaveCSS('position', 'fixed');
  await expect(mobileNav).toHaveCSS('bottom', '0px');
  await expect(mobileNav.locator('button')).toHaveCount(6);
  await expect(mobileNav.locator('button').first()).toHaveCSS('min-height', '58px');

  await expect(app.locator('.dashboard-hero')).toHaveCSS('border-radius', '20px');
  await expect(app.locator('.dashboard-hero')).toHaveCSS('padding-left', '21px');
  await expect(app.locator('.metrics-grid')).toHaveCSS('column-gap', '9px');
  const metricColumns = await app.locator('.metrics-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(metricColumns.split(' ').length).toBe(2);
  await expect(app.locator('.metric').first()).toHaveCSS('min-height', '93px');
  await expect(app.locator('.metric').first()).toHaveCSS('padding-left', '13px');
  await expect(app.locator('.quick-panel')).toHaveCSS('padding-left', '17px');
  await expect(app.locator('.quick-panel')).toHaveCSS('border-radius', '17px');
}

async function assertDesktopSourceGeometry(page) {
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  const columns = await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(Math.round(Number.parseFloat(columns.split(' ')[0]))).toBe(280);
  await expect(page.locator('.topbar')).toHaveCSS('position', 'sticky');
  await expect(page.locator('.dashboard-hero')).toHaveCSS('min-height', '250px');
  await expect(page.locator('.dashboard-hero')).toHaveCSS('border-radius', '24px');
  const metricColumns = await page.locator('.metrics-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(metricColumns.split(' ').length).toBe(4);
  await expect(page.locator('.quick-actions')).toHaveCSS('grid-template-columns', /.+/);
}

async function assertPrivateUiGeometry(app) {
  const dashboardColumns = app.locator('.dashboard-page > .two-column');
  if (await dashboardColumns.count()) {
    await expect(dashboardColumns).toHaveCSS('align-items', 'start');
  }
  const card = app.locator('.movement-list > article').filter({ hasText: 'Machine oil 500 ml' }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('display', 'flex');
  await expect(card).toHaveCSS('border-radius', '13px');
  await expect(card).toHaveCSS('padding-top', '12px');
  await expect(card).toHaveCSS('padding-right', '13px');
  await expect(card).toHaveCSS('align-items', 'flex-start');
  const columns = card.locator(':scope > div');
  const left = await columns.nth(0).boundingBox();
  const right = await columns.nth(1).boundingBox();
  expect((left?.x ?? 0) + (left?.width ?? 0)).toBeLessThanOrEqual((right?.x ?? 0) + 1);
}

async function verifyWarehouseFlow(app) {
  await expect(app.getByRole('heading', { name: 'Warehouse overview', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(app.locator('.metrics-grid .metric')).toHaveCount(4);
  await expect(app.getByText('Machine oil 500 ml', { exact: true }).first()).toBeVisible();
  const mobileNav = app.locator('.mobile-nav button');
  await expect(mobileNav).toHaveCount(6);

  await mobileNav.nth(1).click();
  await expect(app.getByRole('heading', { name: 'Products and stock', level: 1 })).toBeVisible();
  await expect(app.getByText('Industrial gloves', { exact: true }).first()).toBeVisible();
  await expect(app.locator('.product-table')).toBeHidden();
  await expect(app.locator('.product-mobile-list')).toBeVisible();
  await expect(app.locator('.product-mobile-list > article').first()).toHaveCSS('border-radius', '14px');

  await mobileNav.nth(2).click();
  await expect(app.getByRole('heading', { name: 'Stock movement', level: 1 })).toBeVisible();
  const scan = app.getByPlaceholder('Scan or product code');
  await scan.fill('859000000001');
  await scan.press('Enter');
  await expect(app.getByText('Industrial gloves', { exact: true }).first()).toBeVisible();

  await app.locator('.operation-types button').filter({ hasText: 'Move' }).click();
  await app.getByLabel('Product').selectOption('product-gloves');
  await app.getByLabel('From location').selectOption('location-a01');
  await app.getByLabel('To location').selectOption('location-b02');
  await app.getByLabel('Quantity').fill('5');
  await app.getByLabel('Note').fill('Public preview move');
  await app.getByRole('button', { name: 'Save movement' }).click();
  await expect(app.getByRole('status')).toContainText('Movement saved safely.');

  await mobileNav.nth(3).click();
  await expect(app.getByRole('heading', { name: 'Movement history', level: 1 })).toBeVisible();
  await expect(app.getByText('Public preview move', { exact: false })).toBeVisible();

  await mobileNav.nth(4).click();
  await expect(app.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
}

test('desktop wrapper preserves the exact 390x844 source viewport, flags and full workflow', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await assertEnglishWrapper(page);

  const app = page.frameLocator('iframe[title="Aardvarkland WMS-Mini"]');
  await expect(app.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await expect(app.locator('html')).toHaveAttribute('lang', /en/);
  await expect(app.getByRole('heading', { name: 'Warehouse overview', level: 1 })).toBeVisible();
  await assertMobileSourceGeometry(app);
  await page.screenshot({ path: `${screenshotDir}/01-mini-wrapper-source-dashboard.png`, fullPage: true });

  await assertRealLanguageFlags(app, page);

  await app.locator('.mobile-nav button').nth(3).click();
  await assertPrivateUiGeometry(app);
  await app.locator('.movement-list > article').filter({ hasText: 'Machine oil 500 ml' }).first().screenshot({ path: `${screenshotDir}/03-machine-oil-movement-card.png` });
  await app.locator('.mobile-nav button').nth(0).click();

  await verifyWarehouseFlow(app);
  await page.screenshot({ path: `${screenshotDir}/04-mini-wrapper-functional-flow.png`, fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('standalone desktop uses the private source sidebar, hero and four-column metrics', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}app/?source-parity=1`, { waitUntil: 'networkidle' });
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', /en/);
  await expect(page.getByRole('heading', { name: 'Warehouse overview', level: 1 })).toBeVisible();
  await assertDesktopSourceGeometry(page);
  await expect(page.locator('.language-switch')).toHaveAttribute('data-language-code', 'en');
  expect(await computedBackground(page.locator('.language-switch'), '::after')).toContain('/icons/flags/gb.svg');
  await page.screenshot({ path: `${screenshotDir}/05-mini-standalone-desktop-source.png`, fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('real mobile viewport keeps source geometry and the selected flag in light and dark mode', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/app\//);
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', /en/);
  await expect(page.getByRole('heading', { name: 'Warehouse overview', level: 1 })).toBeVisible();
  await expect(page.getByText('Machine oil 500 ml', { exact: true }).first()).toBeVisible();
  await assertMobileSourceGeometry(page);

  const trigger = page.locator('.language-switch');
  await expect(trigger).toHaveAttribute('data-language-code', 'en');
  await expect(trigger.locator('svg')).toHaveCSS('display', 'none');
  expect(await computedBackground(trigger, '::after')).toContain('/icons/flags/gb.svg');
  await page.screenshot({ path: `${screenshotDir}/06-mini-mobile-source-light.png` });

  await page.locator('.theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.mobile-nav')).toHaveCSS('background-color', 'rgba(14, 21, 28, 0.95)');
  await page.screenshot({ path: `${screenshotDir}/07-mini-mobile-source-dark.png` });

  await page.locator('.mobile-nav button').nth(3).click();
  await assertPrivateUiGeometry(page);
  await page.screenshot({ path: `${screenshotDir}/08-mini-mobile-history-dark.png` });
  expect(pageErrors).toEqual([]);
});