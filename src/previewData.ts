import type { MiniState } from './types';

export function previewWarehouse(): MiniState {
  const createdAt = '2026-09-01T08:00:00.000Z';
  return {
    schemaVersion: 3,
    warehouseName: 'Aardvarkland Demo Warehouse',
    categories: [
      { id: 'category-safety', name: 'Safety', createdAt },
      { id: 'category-maintenance', name: 'Maintenance', createdAt },
      { id: 'category-packaging', name: 'Packaging', createdAt },
    ],
    products: [
      { id: 'product-gloves', sku: 'GLO-001', name: 'Industrial gloves', barcode: '859000000001', unit: 'pcs', minimumStock: 20, categoryId: 'category-safety', createdAt, updatedAt: createdAt },
      { id: 'product-oil', sku: 'OIL-500', name: 'Machine oil 500 ml', barcode: '859000000002', unit: 'pcs', minimumStock: 10, categoryId: 'category-maintenance', createdAt, updatedAt: createdAt },
      { id: 'product-tape', sku: 'TAP-048', name: 'Packing tape 48 mm', barcode: '859000000003', unit: 'pcs', minimumStock: 25, categoryId: 'category-packaging', createdAt, updatedAt: createdAt },
    ],
    locations: [
      { id: 'location-a01', code: 'A-01', name: 'Rack A / bin 01', createdAt },
      { id: 'location-b02', code: 'B-02', name: 'Rack B / bin 02', createdAt },
      { id: 'location-dispatch', code: 'DISPATCH', name: 'Dispatch', createdAt },
    ],
    balances: [
      { productId: 'product-gloves', locationId: 'location-a01', quantity: 48 },
      { productId: 'product-gloves', locationId: 'location-b02', quantity: 12 },
      { productId: 'product-oil', locationId: 'location-a01', quantity: 8 },
      { productId: 'product-tape', locationId: 'location-b02', quantity: 120 },
    ],
    batches: [],
    movements: [
      { id: 'movement-tape', type: 'RECEIPT', productId: 'product-tape', fromLocationId: null, toLocationId: 'location-b02', quantity: 120, delta: 120, note: 'Packaging stock', batchId: null, lotNumber: '', expiryDate: null, createdAt },
      { id: 'movement-oil', type: 'RECEIPT', productId: 'product-oil', fromLocationId: null, toLocationId: 'location-a01', quantity: 8, delta: 8, note: 'Maintenance stock', batchId: null, lotNumber: '', expiryDate: null, createdAt },
      { id: 'movement-move', type: 'MOVE', productId: 'product-gloves', fromLocationId: 'location-a01', toLocationId: 'location-b02', quantity: 12, delta: 0, note: 'Picking-bin replenishment', batchId: null, lotNumber: '', expiryDate: null, createdAt },
      { id: 'movement-gloves', type: 'RECEIPT', productId: 'product-gloves', fromLocationId: null, toLocationId: 'location-a01', quantity: 60, delta: 60, note: 'Opening stock', batchId: null, lotNumber: '', expiryDate: null, createdAt },
    ],
    onboardingCompleted: false,
    updatedAt: createdAt,
  };
}
