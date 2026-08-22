import { emptyMiniState } from './domain';
import type { MiniBalance, MiniBatch, MiniCategory, MiniLocation, MiniMovement, MiniProduct, MiniState, MovementType } from './types';

const DATABASE_NAME = 'aardvarkland-mini-wms';
const DATABASE_VERSION = 3;
const STORE_NAME = 'state';
const STATE_KEY = 'warehouse';
const FALLBACK_KEY = 'aardvarkland-mini-wms-state-v3';
const V2_FALLBACK_KEY = 'aardvarkland-mini-wms-state-v2';
const LEGACY_FALLBACK_KEY = 'aardvarkland-mini-wms-state-v1';
const FALLBACK_KEYS = [FALLBACK_KEY, V2_FALLBACK_KEY, LEGACY_FALLBACK_KEY] as const;
const PERSISTENCE_VERSION = 1;

export type StorageBackend = 'indexeddb' | 'localStorage';
type UnknownSchemaState = Omit<Partial<MiniState>, 'schemaVersion'> & { schemaVersion?: unknown };
type PersistenceEnvelope = { persistenceVersion: 1; savedAt: string; state: MiniState };
type PersistenceCandidate = { state: MiniState; savedAtMs: number; envelope: PersistenceEnvelope };

let activeBackend: StorageBackend = 'indexeddb';
let saveQueue: Promise<void> = Promise.resolve();

export async function loadMiniState(): Promise<MiniState> {
  const fallback = readFallbackCandidate();
  let database: IDBDatabase | null = null;

  try {
    database = await openDatabase();
    const stored = await readState(database);
    let primary: PersistenceCandidate | null = null;

    if (stored !== undefined && stored !== null) {
      try {
        primary = toPersistenceCandidate(stored, true);
      } catch {
        primary = null;
      }
    }

    if (fallback && shouldPreferFallback(primary, fallback)) {
      try {
        await writeState(database, fallback.envelope);
        clearFallbackKeys();
        activeBackend = 'indexeddb';
      } catch {
        // The fallback is the newest acknowledged write. Keep it intact until
        // IndexedDB accepts the repair on a later launch/save.
        activeBackend = 'localStorage';
      }
      return fallback.state;
    }

    if (primary) {
      // Upgrade legacy raw IndexedDB documents to the persistence envelope and
      // persist any schema normalization. Failure here does not invalidate the
      // already-read primary state.
      if (!isCanonicalEnvelope(stored, primary)) {
        try {
          await writeState(database, primary.envelope);
        } catch {
          // Keep serving the valid primary snapshot; a future save can repair
          // the persisted representation.
        }
      }
      clearFallbackKeys();
      activeBackend = 'indexeddb';
      return primary.state;
    }

    if (fallback) {
      try {
        await writeState(database, fallback.envelope);
        clearFallbackKeys();
        activeBackend = 'indexeddb';
      } catch {
        activeBackend = 'localStorage';
      }
      return fallback.state;
    }

    activeBackend = 'indexeddb';
    return emptyMiniState();
  } catch {
    activeBackend = 'localStorage';
    return fallback?.state ?? emptyMiniState();
  } finally {
    database?.close();
  }
}

export function saveMiniState(state: MiniState): Promise<StorageBackend> {
  const normalized = normalizeState(state);
  const envelope = createEnvelope(normalized);

  // IndexedDB transactions created by independent calls may finish out of
  // order. Serialize persistence attempts so an older UI snapshot can never
  // commit after a newer one merely because its transaction was slower.
  const operation = saveQueue.then(
    () => persistMiniState(envelope),
    () => persistMiniState(envelope),
  );
  saveQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function persistMiniState(envelope: PersistenceEnvelope): Promise<StorageBackend> {
  try {
    const database = await openDatabase();
    try {
      await writeState(database, envelope);
    } finally {
      database.close();
    }
    activeBackend = 'indexeddb';
    clearFallbackKeys();
    return activeBackend;
  } catch {
    activeBackend = 'localStorage';
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(envelope));
    return activeBackend;
  }
}

export function getStorageBackend(): StorageBackend {
  return activeBackend;
}

export function parseMiniBackup(value: unknown): MiniState {
  if (!isRecord(value)) throw new Error('INVALID_BACKUP');
  const candidate = value as UnknownSchemaState;
  // schemaVersion 1 is the original Mini JSON format and is intentionally
  // accepted so users can restore old backups without data loss.
  if (![1, 2, 3].includes(Number(candidate.schemaVersion))) throw new Error('INVALID_BACKUP');
  if (!Array.isArray(candidate.products) || !Array.isArray(candidate.locations)
    || !Array.isArray(candidate.balances) || !Array.isArray(candidate.movements)) throw new Error('INVALID_BACKUP');
  return normalizeState(candidate, true);
}

function normalizeState(value: unknown, strict = false): MiniState {
  if (!isRecord(value)) {
    if (strict) throw new Error('INVALID_BACKUP');
    return emptyMiniState();
  }
  const state = value as UnknownSchemaState;
  if (![1, 2, 3].includes(Number(state.schemaVersion))) {
    if (strict) throw new Error('INVALID_BACKUP');
    return emptyMiniState();
  }
  const products = normalizeProducts(state.products, strict);
  const categories = normalizeCategories((state as any).categories, strict);
  const locations = normalizeLocations(state.locations, strict);
  const productIds = new Set(products.map((item) => item.id));
  const locationIds = new Set(locations.map((item) => item.id));
  const balances = normalizeBalances(state.balances, productIds, locationIds, strict);
  const movements = normalizeMovements(state.movements, productIds, locationIds, strict);
  const batches = normalizeBatches((state as any).batches, productIds, locationIds, strict);
  if (strict) validateDocumentInvariants({ products, categories, locations, balances, movements, batches });
  const updatedAt = typeof state.updatedAt === 'string' && !Number.isNaN(Date.parse(state.updatedAt))
    ? state.updatedAt : new Date().toISOString();
  const lastBackupAt = typeof state.lastBackupAt === 'string' && !Number.isNaN(Date.parse(state.lastBackupAt))
    ? state.lastBackupAt : undefined;
  return {
    schemaVersion: 3,
    warehouseName: typeof state.warehouseName === 'string' ? state.warehouseName.trim().slice(0, 120) : '',
    products,
    categories,
    batches,
    locations,
    balances,
    movements,
    onboardingCompleted: typeof (state as any).onboardingCompleted === 'boolean' ? (state as any).onboardingCompleted : Boolean(products.length || locations.length),
    updatedAt,
    ...(lastBackupAt ? { lastBackupAt } : {}),
  };
}

function readFallbackCandidate(): PersistenceCandidate | null {
  let newest: PersistenceCandidate | null = null;
  try {
    for (const key of FALLBACK_KEYS) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const candidate = toPersistenceCandidate(JSON.parse(raw), true);
        if (!newest || candidate.savedAtMs > newest.savedAtMs) newest = candidate;
      } catch {
        // Ignore one corrupt fallback key and continue looking for an older,
        // still-valid application snapshot.
      }
    }
  } catch {
    return null;
  }
  return newest;
}

function clearFallbackKeys(): void {
  try {
    for (const key of FALLBACK_KEYS) window.localStorage.removeItem(key);
  } catch {
    // localStorage may be blocked while IndexedDB is healthy. Failure to clean
    // stale fallback data must not downgrade a successful IndexedDB write.
  }
}

function createEnvelope(state: MiniState, savedAt = new Date().toISOString()): PersistenceEnvelope {
  return { persistenceVersion: PERSISTENCE_VERSION, savedAt, state };
}

function toPersistenceCandidate(value: unknown, strict: boolean): PersistenceCandidate {
  if (isPersistenceEnvelope(value)) {
    const state = normalizeState(value.state, strict);
    const savedAt = validTimestamp(value.savedAt) ? value.savedAt : state.updatedAt;
    return { state, savedAtMs: Date.parse(savedAt), envelope: createEnvelope(state, savedAt) };
  }

  const state = normalizeState(value, strict);
  const rawUpdatedAt = isRecord(value) && validTimestamp(value.updatedAt) ? value.updatedAt : state.updatedAt;
  return { state, savedAtMs: Date.parse(rawUpdatedAt), envelope: createEnvelope(state, rawUpdatedAt) };
}

function shouldPreferFallback(primary: PersistenceCandidate | null, fallback: PersistenceCandidate): boolean {
  if (!primary) return true;
  if (fallback.savedAtMs !== primary.savedAtMs) return fallback.savedAtMs > primary.savedAtMs;
  // Equal timestamps are possible at millisecond resolution. If the snapshots
  // differ, prefer the fallback because its presence represents an
  // acknowledged write that IndexedDB did not accept.
  return JSON.stringify(fallback.state) !== JSON.stringify(primary.state);
}

function isCanonicalEnvelope(value: unknown, candidate: PersistenceCandidate): boolean {
  if (!isPersistenceEnvelope(value)) return false;
  return value.savedAt === candidate.envelope.savedAt
    && JSON.stringify(value.state) === JSON.stringify(candidate.state);
}

function isPersistenceEnvelope(value: unknown): value is { persistenceVersion: 1; savedAt: string; state: unknown } {
  return isRecord(value)
    && value.persistenceVersion === PERSISTENCE_VERSION
    && typeof value.savedAt === 'string'
    && 'state' in value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeProducts(value: unknown, strict: boolean): MiniProduct[] {
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sku !== 'string' || typeof item.name !== 'string'
      || typeof item.barcode !== 'string' || typeof item.unit !== 'string' || !Number.isFinite(item.minimumStock)
      || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') throw new Error('INVALID_BACKUP');
    return { id: item.id, sku: item.sku, name: item.name, barcode: item.barcode, unit: item.unit,
      minimumStock: Math.max(0, Number(item.minimumStock)), categoryId: typeof item.categoryId === 'string' ? item.categoryId : null, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
}

function normalizeLocations(value: unknown, strict: boolean): MiniLocation[] {
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.code !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string') throw new Error('INVALID_BACKUP');
    return { id: item.id, code: item.code, name: item.name, createdAt: item.createdAt };
  });
}

function normalizeBalances(value: unknown, productIds: Set<string>, locationIds: Set<string>, strict: boolean): MiniBalance[] {
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.productId !== 'string' || typeof item.locationId !== 'string' || !Number.isFinite(item.quantity)
      || !productIds.has(item.productId) || !locationIds.has(item.locationId) || Number(item.quantity) < 0) throw new Error('INVALID_BACKUP');
    return { productId: item.productId, locationId: item.locationId, quantity: Number(item.quantity) };
  });
}

function normalizeMovements(value: unknown, productIds: Set<string>, locationIds: Set<string>, strict: boolean): MiniMovement[] {
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    const validType = item && typeof item === 'object' && ['RECEIPT', 'ISSUE', 'MOVE', 'COUNT'].includes(String((item as { type?: unknown }).type));
    if (!isRecord(item) || !validType || typeof item.id !== 'string' || typeof item.productId !== 'string'
      || !productIds.has(item.productId) || !Number.isFinite(item.quantity) || Number(item.quantity) < 0
      || !Number.isFinite(item.delta) || typeof item.note !== 'string' || typeof item.createdAt !== 'string'
      || (item.fromLocationId !== null && typeof item.fromLocationId !== 'string')
      || (item.toLocationId !== null && typeof item.toLocationId !== 'string')
      || (item.fromLocationId !== null && !locationIds.has(item.fromLocationId))
      || (item.toLocationId !== null && !locationIds.has(item.toLocationId))) throw new Error('INVALID_BACKUP');
    return { id: item.id, type: item.type as MovementType, productId: item.productId,
      fromLocationId: item.fromLocationId as string | null, toLocationId: item.toLocationId as string | null,
      quantity: Number(item.quantity), delta: Number(item.delta), note: item.note, batchId: typeof item.batchId === 'string' ? item.batchId : null, lotNumber: typeof item.lotNumber === 'string' ? item.lotNumber : '', expiryDate: typeof item.expiryDate === 'string' ? item.expiryDate : null, createdAt: item.createdAt };
  });
}

function normalizeCategories(value: unknown, strict: boolean): MiniCategory[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string') throw new Error('INVALID_BACKUP');
    return { id: item.id, name: item.name.trim(), createdAt: item.createdAt };
  });
}

function normalizeBatches(value: unknown, productIds: Set<string>, locationIds: Set<string>, strict: boolean): MiniBatch[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { if (strict) throw new Error('INVALID_BACKUP'); return []; }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.productId !== 'string' || typeof item.locationId !== 'string' || typeof item.lotNumber !== 'string' || !Number.isFinite(item.quantity) || Number(item.quantity) < 0 || !productIds.has(item.productId) || !locationIds.has(item.locationId)) throw new Error('INVALID_BACKUP');
    const expiryDate = typeof item.expiryDate === 'string' ? item.expiryDate : null;
    if (expiryDate && Number.isNaN(Date.parse(`${expiryDate}T00:00:00`))) throw new Error('INVALID_BACKUP');
    return { id: item.id, productId: item.productId, locationId: item.locationId, lotNumber: item.lotNumber, expiryDate, quantity: Number(item.quantity), createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(), updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString() };
  });
}

function validateDocumentInvariants(input: {
  products: MiniProduct[];
  categories: MiniCategory[];
  locations: MiniLocation[];
  balances: MiniBalance[];
  movements: MiniMovement[];
  batches: MiniBatch[];
}): void {
  assertUnique(input.products.map((item) => item.id));
  assertUnique(input.categories.map((item) => item.id));
  assertUnique(input.locations.map((item) => item.id));
  assertUnique(input.movements.map((item) => item.id));
  assertUnique(input.batches.map((item) => item.id));
  assertUnique(input.products.map((item) => item.sku.trim().toUpperCase()));
  assertUnique(input.products.map((item) => item.barcode.trim()).filter(Boolean));
  assertUnique(input.locations.map((item) => item.code.trim().toUpperCase()));
  assertUnique(input.balances.map((item) => `${item.productId}\u0000${item.locationId}`));

  const balanceByKey = new Map(input.balances.map((item) => [`${item.productId}\u0000${item.locationId}`, item.quantity]));
  const batchQuantityByKey = new Map<string, number>();
  for (const batch of input.batches) {
    const key = `${batch.productId}\u0000${batch.locationId}`;
    batchQuantityByKey.set(key, (batchQuantityByKey.get(key) ?? 0) + batch.quantity);
  }
  for (const [key, batchQuantity] of batchQuantityByKey) {
    const balance = balanceByKey.get(key) ?? 0;
    if (batchQuantity > balance) throw new Error('INVALID_BACKUP');
  }
}

function assertUnique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('INVALID_BACKUP');
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Database open failed'));
    request.onblocked = () => reject(new Error('Database upgrade blocked'));
  });
}

function readState(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Database read failed'));
  });
}

function writeState(database: IDBDatabase, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, STATE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Database write failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Database write aborted'));
  });
}