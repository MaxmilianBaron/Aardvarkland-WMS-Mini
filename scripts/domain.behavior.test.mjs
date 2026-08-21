import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMovement,
  deleteLocation,
  deleteProduct,
  stockAt,
  totalStock,
  updateLocation,
  updateProduct,
} from '../src/domain.ts';
import { parseMiniBackup } from '../src/storage.ts';

const timestamp = '2026-08-02T12:00:00.000Z';

function warehouse() {
  return {
    schemaVersion: 2,
    warehouseName: 'Testovací sklad',
    products: [
      { id: 'p1', sku: 'SKU-1', name: 'Produkt 1', barcode: '859000000001', unit: 'ks', minimumStock: 2, createdAt: timestamp, updatedAt: timestamp },
      { id: 'p2', sku: 'SKU-2', name: 'Produkt 2', barcode: '859000000002', unit: 'ks', minimumStock: 0, createdAt: timestamp, updatedAt: timestamp },
    ],
    categories: [],
    batches: [],
    locations: [
      { id: 'l1', code: 'A-01', name: 'Regál A', createdAt: timestamp },
      { id: 'l2', code: 'B-01', name: 'Regál B', createdAt: timestamp },
    ],
    balances: [],
    movements: [],
    updatedAt: timestamp,
  };
}

test('complete warehouse shift keeps balances and append-only history consistent', () => {
  let state = warehouse();
  state = applyMovement(state, { type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 10, note: 'Příjem' });
  state = applyMovement(state, { type: 'MOVE', productId: 'p1', fromLocationId: 'l1', toLocationId: 'l2', quantity: 4 });
  state = applyMovement(state, { type: 'ISSUE', productId: 'p1', fromLocationId: 'l2', quantity: 3 });
  state = applyMovement(state, { type: 'COUNT', productId: 'p1', toLocationId: 'l1', quantity: 7 });

  assert.equal(stockAt(state, 'p1', 'l1'), 7);
  assert.equal(stockAt(state, 'p1', 'l2'), 1);
  assert.equal(totalStock(state, 'p1'), 8);
  assert.deepEqual(state.movements.map((movement) => movement.type), ['COUNT', 'ISSUE', 'MOVE', 'RECEIPT']);
  assert.deepEqual(state.movements.map((movement) => movement.delta), [1, -3, 0, 10]);
});

test('invalid quantities, negative stock, unknown locations and same-location moves are blocked atomically', () => {
  const received = applyMovement(warehouse(), { type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 2 });
  const original = structuredClone(received);

  for (const [expected, input] of [
    ['INVALID_QUANTITY', { type: 'ISSUE', productId: 'p1', fromLocationId: 'l1', quantity: 0 }],
    ['INSUFFICIENT_STOCK', { type: 'ISSUE', productId: 'p1', fromLocationId: 'l1', quantity: 3 }],
    ['LOCATION_REQUIRED', { type: 'RECEIPT', productId: 'p1', toLocationId: 'missing', quantity: 1 }],
    ['SAME_LOCATION', { type: 'MOVE', productId: 'p1', fromLocationId: 'l1', toLocationId: 'l1', quantity: 1 }],
  ]) {
    assert.throws(() => applyMovement(received, input), new RegExp(expected));
    assert.deepEqual(received, original);
  }
});

test('single fully-controlled batch count updates aggregate stock and batch together', () => {
  let state = applyMovement(warehouse(), {
    type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 10, lotNumber: 'LOT-1', expiryDate: '2027-01-01',
  });
  const batchId = state.batches[0].id;

  state = applyMovement(state, { type: 'COUNT', productId: 'p1', toLocationId: 'l1', quantity: 7 });

  assert.equal(stockAt(state, 'p1', 'l1'), 7);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].quantity, 7);
  assert.equal(state.movements[0].batchId, batchId);
  assert.equal(state.movements[0].delta, -3);
});

test('ambiguous multi-batch count is rejected instead of desynchronizing lot stock', () => {
  let state = applyMovement(warehouse(), {
    type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 5, lotNumber: 'LOT-A', expiryDate: '2027-01-01',
  });
  state = applyMovement(state, {
    type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 5, lotNumber: 'LOT-B', expiryDate: '2027-02-01',
  });
  const original = structuredClone(state);

  assert.throws(
    () => applyMovement(state, { type: 'COUNT', productId: 'p1', toLocationId: 'l1', quantity: 8 }),
    /BATCH_COUNT_REQUIRED/,
  );
  assert.deepEqual(state, original);
});

test('hidden stale batch id cannot corrupt a later receipt', () => {
  let state = applyMovement(warehouse(), {
    type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 5, lotNumber: 'LOT-A', expiryDate: '2027-01-01',
  });
  const existingBatch = state.batches[0];

  state = applyMovement(state, {
    type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 2, batchId: existingBatch.id,
  });

  assert.equal(stockAt(state, 'p1', 'l1'), 7);
  assert.equal(state.batches[0].quantity, 5);
  assert.equal(state.movements[0].batchId, null);
});

test('master-data edits normalize codes and reject duplicates', () => {
  let state = warehouse();
  state = updateProduct(state, 'p1', { sku: ' new-sku ', name: ' Nový název ', barcode: '123', unit: '', minimumStock: 5 });
  assert.equal(state.products[0].sku, 'NEW-SKU');
  assert.equal(state.products[0].unit, 'ks');
  assert.throws(() => updateProduct(state, 'p1', { sku: 'sku-2', name: 'Kolize', barcode: '', unit: 'ks', minimumStock: 0 }), /DUPLICATE_SKU/);
  assert.throws(() => updateProduct(state, 'p1', { sku: 'SKU-X', name: 'Kolize', barcode: '859000000002', unit: 'ks', minimumStock: 0 }), /DUPLICATE_BARCODE/);

  state = updateLocation(state, 'l1', { code: ' c-01 ', name: ' Nová lokace ' });
  assert.equal(state.locations[0].code, 'C-01');
  assert.throws(() => updateLocation(state, 'l1', { code: 'b-01', name: 'Kolize' }), /DUPLICATE_LOCATION/);
});

test('movement history protects referenced products and locations from deletion', () => {
  const used = applyMovement(warehouse(), { type: 'RECEIPT', productId: 'p1', toLocationId: 'l1', quantity: 1 });
  assert.throws(() => deleteProduct(used, 'p1'), /PRODUCT_IN_USE/);
  assert.throws(() => deleteLocation(used, 'l1'), /LOCATION_IN_USE/);

  const clean = deleteLocation(deleteProduct(warehouse(), 'p2'), 'l2');
  assert.equal(clean.products.some((product) => product.id === 'p2'), false);
  assert.equal(clean.locations.some((location) => location.id === 'l2'), false);
});

test('stock without movement history still protects master data from destructive deletion', () => {
  const stockOnly = {
    ...warehouse(),
    balances: [{ productId: 'p1', locationId: 'l1', quantity: 4 }],
    batches: [{ id: 'b1', productId: 'p1', locationId: 'l1', lotNumber: 'LOT-1', expiryDate: null, quantity: 4, createdAt: timestamp, updatedAt: timestamp }],
  };
  const original = structuredClone(stockOnly);

  assert.throws(() => deleteProduct(stockOnly, 'p1'), /PRODUCT_IN_USE/);
  assert.throws(() => deleteLocation(stockOnly, 'l1'), /LOCATION_IN_USE/);
  assert.deepEqual(stockOnly, original);
});

test('valid schema v1 backup migrates to v3 without losing warehouse data', () => {
  const legacy = { ...warehouse(), schemaVersion: 1 };
  const migrated = parseMiniBackup(legacy);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.categories, []);
  assert.deepEqual(migrated.batches, []);
  assert.equal(migrated.products.length, 2);
  assert.equal(migrated.locations.length, 2);
  assert.equal(migrated.warehouseName, 'Testovací sklad');
});

test('corrupt backups are rejected before they can replace current data', () => {
  const validBalance = { productId: 'p1', locationId: 'l1', quantity: 5 };
  const invalidCases = [
    null,
    { ...warehouse(), schemaVersion: 99 },
    { ...warehouse(), balances: [{ productId: 'p1', locationId: 'l1', quantity: -1 }] },
    { ...warehouse(), balances: [{ productId: 'missing', locationId: 'l1', quantity: 1 }] },
    { ...warehouse(), balances: [validBalance, { ...validBalance, quantity: 2 }] },
    { ...warehouse(), products: [...warehouse().products, { ...warehouse().products[0] }] },
    { ...warehouse(), balances: [validBalance], batches: [{ id: 'b1', productId: 'p1', locationId: 'l1', lotNumber: 'LOT-X', expiryDate: null, quantity: 6, createdAt: timestamp, updatedAt: timestamp }] },
    { ...warehouse(), balances: [validBalance], batches: [{ id: 'b1', productId: 'p1', locationId: 'l1', lotNumber: 'LOT-X', expiryDate: 'not-a-date', quantity: 5, createdAt: timestamp, updatedAt: timestamp }] },
    { ...warehouse(), movements: [{ id: 'm1', type: 'RECEIPT', productId: 'missing', fromLocationId: null, toLocationId: 'l1', quantity: 1, delta: 1, note: '', createdAt: timestamp }] },
  ];

  for (const backup of invalidCases) assert.throws(() => parseMiniBackup(backup), /INVALID_BACKUP/);
});
