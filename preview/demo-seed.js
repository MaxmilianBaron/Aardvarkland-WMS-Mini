(() => {
  const previewVersion = 'wms-mini-preview-2026-08-17-v7';
  const markerKey = 'aardvarkland-mini-public-preview-version';
  const stateKey = 'aardvarkland-mini-wms-state-v3';
  const databaseName = 'aardvarkland-mini-wms';
  const databaseVersion = 3;
  const storeName = 'state';
  const warehouseKey = 'warehouse';
  const now = '2026-08-17T00:00:00.000Z';
  const state = {
    schemaVersion: 3,
    warehouseName: 'Aardvarkland Demo Warehouse',
    products: [
      { id: 'product-gloves', sku: 'RUK-001', name: 'Industrial gloves', barcode: '859000000001', unit: 'pcs', minimumStock: 20, categoryId: 'category-safety', createdAt: now, updatedAt: now },
      { id: 'product-lube', sku: 'MAZ-500', name: 'Machine oil 500 ml', barcode: '859000000002', unit: 'pcs', minimumStock: 10, categoryId: 'category-service', createdAt: now, updatedAt: now },
      { id: 'product-tape', sku: 'PAS-048', name: 'Packing tape 48 mm', barcode: '859000000003', unit: 'pcs', minimumStock: 25, categoryId: 'category-pack', createdAt: now, updatedAt: now },
    ],
    categories: [
      { id: 'category-safety', name: 'Safety', createdAt: now },
      { id: 'category-service', name: 'Maintenance', createdAt: now },
      { id: 'category-pack', name: 'Packaging', createdAt: now },
    ],
    batches: [
      { id: 'batch-lube-001', productId: 'product-lube', locationId: 'location-a01', lotNumber: 'LOT-2026-0817', expiryDate: '2026-09-10', quantity: 8, createdAt: now, updatedAt: now },
    ],
    locations: [
      { id: 'location-a01', code: 'A-01', name: 'Rack A / bin 01', createdAt: now },
      { id: 'location-b02', code: 'B-02', name: 'Rack B / bin 02', createdAt: now },
      { id: 'location-exp', code: 'EXP', name: 'Dispatch', createdAt: now },
    ],
    balances: [
      { productId: 'product-gloves', locationId: 'location-a01', quantity: 48 },
      { productId: 'product-gloves', locationId: 'location-b02', quantity: 12 },
      { productId: 'product-lube', locationId: 'location-a01', quantity: 8 },
      { productId: 'product-tape', locationId: 'location-b02', quantity: 120 },
    ],
    movements: [
      { id: 'movement-001', type: 'RECEIPT', productId: 'product-gloves', fromLocationId: null, toLocationId: 'location-a01', quantity: 60, delta: 60, note: 'Opening stock', batchId: null, lotNumber: '', expiryDate: null, createdAt: '2026-08-16T08:00:00.000Z' },
      { id: 'movement-002', type: 'MOVE', productId: 'product-gloves', fromLocationId: 'location-a01', toLocationId: 'location-b02', quantity: 12, delta: 0, note: 'Picking-bin replenishment', batchId: null, lotNumber: '', expiryDate: null, createdAt: '2026-08-16T10:30:00.000Z' },
      { id: 'movement-003', type: 'RECEIPT', productId: 'product-lube', fromLocationId: null, toLocationId: 'location-a01', quantity: 8, delta: 8, note: 'Maintenance stock', batchId: 'batch-lube-001', lotNumber: 'LOT-2026-0817', expiryDate: '2026-09-10', createdAt: '2026-08-16T12:00:00.000Z' },
      { id: 'movement-004', type: 'RECEIPT', productId: 'product-tape', fromLocationId: null, toLocationId: 'location-b02', quantity: 120, delta: 120, note: 'Packaging stock', batchId: null, lotNumber: '', expiryDate: null, createdAt: '2026-08-16T13:15:00.000Z' },
    ],
    onboardingCompleted: true,
    updatedAt: now,
  };

  function seedIndexedDb() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve();
      const request = window.indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        try {
          const transaction = db.transaction(storeName, 'readwrite');
          transaction.objectStore(storeName).put(state, warehouseKey);
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); resolve(); };
          transaction.onabort = transaction.onerror;
        } catch {
          db.close();
          resolve();
        }
      };
    });
  }

  window.__WMS_MINI_DEMO_READY__ = (async () => {
    try {
      window.localStorage.setItem('aardvarkland-mini-language', 'en');
      if (window.localStorage.getItem(markerKey) !== previewVersion) {
        window.localStorage.setItem(stateKey, JSON.stringify(state));
        window.localStorage.removeItem('aardvarkland-mini-wms-state-v2');
        window.localStorage.removeItem('aardvarkland-mini-wms-state-v1');
        window.localStorage.removeItem('aardvarkland-mini-lock-v1');
        await seedIndexedDb();
        window.localStorage.setItem(markerKey, previewVersion);
      }
    } catch {}
  })();
})();
