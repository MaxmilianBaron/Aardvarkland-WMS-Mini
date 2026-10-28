import { test, expect } from '@playwright/test';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4175/';
test.use({ serviceWorkers: 'block' });

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
