import type { MiniBalance, MiniLocation, MiniMovement, MiniProduct, MiniState, MovementInput } from './types';

export function emptyMiniState(): MiniState {
  return {
    schemaVersion: 3,
    warehouseName: '',
    products: [],
    categories: [],
    batches: [],
    locations: [],
    balances: [],
    movements: [],
    onboardingCompleted: false,
    updatedAt: new Date().toISOString(),
  };
}

export function stockAt(state: MiniState, productId: string, locationId: string): number {
  return state.balances.find((row) => row.productId === productId && row.locationId === locationId)?.quantity ?? 0;
}

export function totalStock(state: MiniState, productId: string): number {
  return state.balances
    .filter((row) => row.productId === productId)
    .reduce((sum, row) => sum + row.quantity, 0);
}

export function applyMovement(state: MiniState, input: MovementInput): MiniState {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || (input.type !== 'COUNT' && quantity <= 0)) {
    throw new Error('INVALID_QUANTITY');
  }
  if (!state.products.some((product) => product.id === input.productId)) {
    throw new Error('PRODUCT_REQUIRED');
  }

  const from = input.fromLocationId?.trim() || undefined;
  const to = input.toLocationId?.trim() || undefined;
  if ((input.type === 'ISSUE' || input.type === 'MOVE') && !from) throw new Error('FROM_REQUIRED');
  if ((input.type === 'RECEIPT' || input.type === 'MOVE' || input.type === 'COUNT') && !to) throw new Error('TO_REQUIRED');
  if (from && !state.locations.some((location) => location.id === from)) throw new Error('LOCATION_REQUIRED');
  if (to && !state.locations.some((location) => location.id === to)) throw new Error('LOCATION_REQUIRED');
  if (input.type === 'MOVE' && from === to) throw new Error('SAME_LOCATION');

  // Receipt and count do not expose an existing-batch selector in the current UI.
  // Ignore a hidden stale batch id left over from a previous issue/move operation.
  let batchId = input.type === 'RECEIPT' || input.type === 'COUNT'
    ? null
    : input.batchId?.trim() || null;
  let lotNumber = input.lotNumber?.trim() || '';
  let expiryDate = input.expiryDate?.trim() || null;
  if (expiryDate && Number.isNaN(Date.parse(`${expiryDate}T00:00:00`))) throw new Error('INVALID_EXPIRY');

  if ((input.type === 'ISSUE' || input.type === 'MOVE') && !batchId
    && (state.batches ?? []).some((batch) => batch.productId === input.productId && batch.locationId === from && batch.quantity > 0)) {
    throw new Error('BATCH_REQUIRED');
  }

  const balances = state.balances.map((row) => ({ ...row }));
  const batches = (state.batches ?? []).map((row) => ({ ...row }));
  const now = new Date().toISOString();
  let delta = quantity;

  if (input.type === 'COUNT') {
    const before = stockFromRows(balances, input.productId, to!);
    const activeBatches = batches.filter((batch) => batch.productId === input.productId && batch.locationId === to && batch.quantity > 0);
    const batchQuantity = activeBatches.reduce((sum, batch) => sum + batch.quantity, 0);

    if (activeBatches.length === 0) {
      setBalance(balances, input.productId, to!, quantity);
      delta = quantity - before;
    } else if (activeBatches.length === 1 && batchQuantity === before) {
      // A single batch fully accounts for the location, so the location count is
      // unambiguous and can safely update both the batch and the aggregate balance.
      const batch = activeBatches[0];
      batchId = batch.id;
      lotNumber = batch.lotNumber;
      expiryDate = batch.expiryDate;
      batch.quantity = quantity;
      batch.updatedAt = now;
      setBalance(balances, input.productId, to!, quantity);
      delta = quantity - before;
    } else {
      // With multiple batches (or mixed batched/unbatched stock), a total count
      // cannot be mapped back to lots without losing traceability.
      throw new Error('BATCH_COUNT_REQUIRED');
    }
  } else if (input.type === 'RECEIPT') {
    setBalance(balances, input.productId, to!, stockFromRows(balances, input.productId, to!) + quantity);
  } else if (input.type === 'ISSUE') {
    const available = stockFromRows(balances, input.productId, from!);
    if (available < quantity) throw new Error('INSUFFICIENT_STOCK');
    setBalance(balances, input.productId, from!, available - quantity);
    delta = -quantity;
  } else if (input.type === 'MOVE') {
    const available = stockFromRows(balances, input.productId, from!);
    if (available < quantity) throw new Error('INSUFFICIENT_STOCK');
    setBalance(balances, input.productId, from!, available - quantity);
    setBalance(balances, input.productId, to!, stockFromRows(balances, input.productId, to!) + quantity);
    delta = 0;
  }

  if (batchId && input.type !== 'COUNT') {
    const batch = batches.find((row) => row.id === batchId && row.productId === input.productId);
    if (!batch) throw new Error('BATCH_REQUIRED');
    lotNumber = batch.lotNumber;
    expiryDate = batch.expiryDate;
    const source = batches.find((row) => row.id === batchId && row.locationId === from);
    if (!source) throw new Error('BATCH_REQUIRED');
    if ((input.type === 'ISSUE' || input.type === 'MOVE') && source.quantity < quantity) throw new Error('INSUFFICIENT_BATCH_STOCK');
    if (input.type === 'ISSUE') {
      source.quantity -= quantity;
      source.updatedAt = now;
    }
    if (input.type === 'MOVE') {
      source.quantity -= quantity;
      source.updatedAt = now;
      const target = batches.find((row) => row.productId === input.productId && row.locationId === to && row.lotNumber === lotNumber && row.expiryDate === expiryDate);
      if (target) {
        target.quantity += quantity;
        target.updatedAt = now;
      } else {
        batches.push({ id: createId(), productId: input.productId, locationId: to!, lotNumber, expiryDate, quantity, createdAt: now, updatedAt: now });
      }
    }
  } else if (input.type === 'RECEIPT' && (lotNumber || expiryDate)) {
    const existing = batches.find((row) => row.productId === input.productId && row.locationId === to && row.lotNumber === lotNumber && row.expiryDate === expiryDate);
    if (existing) {
      existing.quantity += quantity;
      existing.updatedAt = now;
      batchId = existing.id;
    } else {
      batchId = createId();
      batches.push({ id: batchId, productId: input.productId, locationId: to!, lotNumber, expiryDate, quantity, createdAt: now, updatedAt: now });
    }
  }

  const movement: MiniMovement = {
    id: createId(),
    type: input.type,
    productId: input.productId,
    fromLocationId: from ?? null,
    toLocationId: to ?? null,
    quantity,
    delta,
    note: input.note?.trim() ?? '',
    batchId, lotNumber, expiryDate,
    createdAt: now,
  };

  return {
    ...state,
    balances: balances.filter((row) => row.quantity !== 0),
    batches: batches.filter((row) => row.quantity !== 0),
    // Movement history is append-only. The UI paginates it; never silently
    // discard old warehouse movements as a side effect of a new operation.
    movements: [movement, ...state.movements],
    updatedAt: now,
  };
}

export function updateProduct(state: MiniState, productId: string, patch: Pick<MiniProduct, 'sku' | 'name' | 'barcode' | 'unit' | 'minimumStock' | 'categoryId'>): MiniState {
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error('PRODUCT_REQUIRED');
  const sku = patch.sku.trim().toUpperCase();
  const name = patch.name.trim();
  const barcode = patch.barcode.trim();
  const unit = patch.unit.trim() || 'ks';
  const minimumStock = Number(patch.minimumStock);
  if (!sku || !name || !Number.isFinite(minimumStock) || minimumStock < 0) throw new Error('INVALID_PRODUCT');
  if (state.products.some((item) => item.id !== productId && item.sku.toUpperCase() === sku)) throw new Error('DUPLICATE_SKU');
  if (barcode && state.products.some((item) => item.id !== productId && item.barcode === barcode)) throw new Error('DUPLICATE_BARCODE');
  const now = new Date().toISOString();
  return {
    ...state,
    products: state.products.map((item) => item.id === productId ? { ...item, sku, name, barcode, unit, minimumStock, categoryId: patch.categoryId || null, updatedAt: now } : item),
    updatedAt: now,
  };
}

export function updateLocation(state: MiniState, locationId: string, patch: Pick<MiniLocation, 'code' | 'name'>): MiniState {
  const location = state.locations.find((item) => item.id === locationId);
  if (!location) throw new Error('LOCATION_REQUIRED');
  const code = patch.code.trim().toUpperCase();
  const name = patch.name.trim();
  if (!code || !name) throw new Error('INVALID_LOCATION');
  if (state.locations.some((item) => item.id !== locationId && item.code.toUpperCase() === code)) throw new Error('DUPLICATE_LOCATION');
  return {
    ...state,
    locations: state.locations.map((item) => item.id === locationId ? { ...item, code, name } : item),
    updatedAt: new Date().toISOString(),
  };
}

export function deleteProduct(state: MiniState, productId: string): MiniState {
  if (!state.products.some((item) => item.id === productId)) throw new Error('PRODUCT_REQUIRED');
  const referencedByHistory = state.movements.some((movement) => movement.productId === productId);
  const hasStock = state.balances.some((row) => row.productId === productId && row.quantity !== 0);
  const hasBatchStock = (state.batches ?? []).some((batch) => batch.productId === productId && batch.quantity !== 0);
  if (referencedByHistory || hasStock || hasBatchStock) throw new Error('PRODUCT_IN_USE');
  return { ...state, products: state.products.filter((item) => item.id !== productId), balances: state.balances.filter((row) => row.productId !== productId), batches: state.batches.filter((batch) => batch.productId !== productId), updatedAt: new Date().toISOString() };
}

export function deleteLocation(state: MiniState, locationId: string): MiniState {
  if (!state.locations.some((item) => item.id === locationId)) throw new Error('LOCATION_REQUIRED');
  const referencedByHistory = state.movements.some((movement) => movement.fromLocationId === locationId || movement.toLocationId === locationId);
  const hasStock = state.balances.some((row) => row.locationId === locationId && row.quantity !== 0);
  const hasBatchStock = (state.batches ?? []).some((batch) => batch.locationId === locationId && batch.quantity !== 0);
  if (referencedByHistory || hasStock || hasBatchStock) throw new Error('LOCATION_IN_USE');
  return { ...state, locations: state.locations.filter((item) => item.id !== locationId), balances: state.balances.filter((row) => row.locationId !== locationId), batches: state.batches.filter((batch) => batch.locationId !== locationId), updatedAt: new Date().toISOString() };
}

export function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mini-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stockFromRows(rows: MiniBalance[], productId: string, locationId: string): number {
  return rows.find((row) => row.productId === productId && row.locationId === locationId)?.quantity ?? 0;
}

function setBalance(rows: MiniBalance[], productId: string, locationId: string, quantity: number): void {
  const existing = rows.find((row) => row.productId === productId && row.locationId === locationId);
  if (existing) {
    existing.quantity = quantity;
  } else {
    rows.push({ productId, locationId, quantity });
  }
}