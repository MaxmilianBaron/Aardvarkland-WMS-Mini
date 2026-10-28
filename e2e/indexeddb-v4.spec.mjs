import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4175/';
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

// A real Chromium DB, seeded before the app executes any storage code.
async function seedV3(page) {
  await page.goto(base + 'preview.css');
  await page.evaluate(async () => {
    const now = '2026-10-27T12:00:00.000Z';
    const state = {
      schemaVersion: 3, warehouseName: 'Migrated warehouse',
      products: [{
        id: 'p', sku: 'P', name: 'Product', barcode: '', unit: 'kg',
        minimumStock: 0, categoryId: null, createdAt: now, updatedAt: now,
      }],
      categories: [], batches: [],
      locations: [{ id: 'l', code: 'L', name: 'Location', createdAt: now }],
      balances: [{ productId: 'p', locationId: 'l', quantity: 1 }],
      movements: Array.from({ length: 30 }, (_, i) => ({
        id: 'movement-' + i, type: 'RECEIPT', productId: 'p',
        fromLocationId: null, toLocationId: 'l',
        quantity: 1, delta: 1, note: 'Movement ' + i,
        batchId: null, lotNumber: '', expiryDate: null, createdAt: now,
      })),
      onboardingCompleted: true, updatedAt: now,
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aardvarkland-mini-wms', 3);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ persistenceVersion: 1, savedAt: now, state }, 'warehouse');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

async function inspectV4(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aardvarkland-mini-wms', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['state', 'movements'], 'readonly');
        const head = tx.objectStore('state').get('warehouse-incremental-v1');
        const old = tx.objectStore('state').get('warehouse');
        const movements = tx.objectStore('movements').getAll();
        tx.oncomplete = () => resolve({
          head: head.result ?? null, legacy: old.result,
          rows: movements.result ?? [],
        });
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

test('Chromium upgrades version 3 atomically and preserves the whole movement history', async ({ page }) => {
  await seedV3(page);
  await page.goto(base + 'app/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
  const actual = await inspectV4(page);
  expect(actual.head.persistenceVersion).toBe(2);
  expect(actual.head.revision).toBe(1);
  expect(actual.rows).toHaveLength(30);
  expect(actual.legacy.state.movements).toHaveLength(30);
  expect(actual.rows.sort((a, b) => b.order - a.order).map(r => r.row.id)).toEqual(
    Array.from({ length: 30 }, (_, i) => 'movement-' + i),
  );
});

test('Chromium aborted upgrade keeps old document and retries cleanly on reload', async ({ page }) => {
  await seedV3(page);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'movements' && sessionStorage.getItem('allowMigration') !== '1') {
        throw new DOMException('Simulated quota during migration', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.goto(base + 'app/');
  await expect(page.locator('.app-shell')).toBeVisible();
  const failed = await inspectV4(page);
  expect(failed.head).toBeNull();
  expect(failed.rows).toHaveLength(0);
  expect(failed.legacy.state.movements).toHaveLength(30);

  await page.evaluate(() => sessionStorage.setItem('allowMigration', '1'));
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  const recovered = await inspectV4(page);
  expect(recovered.head.persistenceVersion).toBe(2);
  expect(recovered.rows).toHaveLength(30);
  expect(recovered.legacy.state.movements).toHaveLength(30);
});

test('a migrated warehouse exports and restores its complete JSON backup in a fresh browser profile', async ({ page, browser }, testInfo) => {
  async function downloadBackup(target, filename) {
    const pending = target.waitForEvent('download');
    await target.getByRole('button', { name: 'Download backup', exact: true }).click();
    const download = await pending;
    const path = testInfo.outputPath(filename);
    await download.saveAs(path);
    return { path, state: JSON.parse(await readFile(path, 'utf8')) };
  }

  await seedV3(page);
  await page.goto(base + 'app/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
  await page.locator('.mobile-nav button').nth(5).click();
  const exported = await downloadBackup(page, 'migrated-warehouse.json');
  expect(exported.state.schemaVersion).toBe(3);
  expect(exported.state.warehouseName).toBe('Migrated warehouse');
  expect(exported.state.movements).toHaveLength(30);
  expect(exported.state.balances).toEqual([{ productId: 'p', locationId: 'l', quantity: 1 }]);

  const clean = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  try {
    const restored = await clean.newPage();
    await restored.goto(base + 'app/');
    await expect(restored.locator('.app-shell')).toBeVisible();
    const skip = restored.locator('.modal-card .button--secondary');
    if (await skip.isVisible()) await skip.click();
    await expect(restored.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
    await restored.locator('.mobile-nav button').nth(5).click();
    restored.on('dialog', dialog => dialog.accept());
    await restored.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(exported.path);
    await expect(restored.locator('.toast')).toContainText('Backup restored.');
    await expect.poll(async () => (await inspectV4(restored)).head?.warehouseName).toBe('Migrated warehouse');
    await expect(restored.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
    await restored.reload();
    await expect(restored.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
    await restored.locator('.mobile-nav button').nth(5).click();
    const roundtrip = await downloadBackup(restored, 'restored-warehouse.json');
    expect({ ...roundtrip.state, lastBackupAt: undefined }).toEqual({ ...exported.state, lastBackupAt: undefined });
  } finally {
    await clean.close();
  }
});
