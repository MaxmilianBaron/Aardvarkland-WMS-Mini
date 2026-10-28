import type { MiniState } from './types';

// Version 3 remains readable: its "state/warehouse" document is deliberately
// not deleted. New writes are committed to separate stores and a v4 marker.
const DATABASE_NAME = 'aardvarkland-mini-wms';
export const DATABASE_VERSION = 4;
const LEGACY_STORE = 'state';
const LEGACY_KEY = 'warehouse';
const HEAD_KEY = 'warehouse-incremental-v1';
const ROW_STORES = ['products', 'categories', 'locations', 'balances', 'batches', 'movements'] as const;
type RowStore = typeof ROW_STORES[number];
type OtherStore = Exclude<RowStore, 'movements'>;
const ALL_STORES = [LEGACY_STORE, ...ROW_STORES];

export type StoredSnapshot = {
  kind: 'legacy' | 'incremental';
  value: unknown;
  revision: number;
  movementOrder: number;
};
export type PersistedBaseline = { state: MiniState | null; revision: number; movementOrder: number };
export type StoredEnvelope = { persistenceVersion: 1; savedAt: string; state: MiniState };
type Head = {
  persistenceVersion: 2;
  revision: number;
  movementOrder: number;
  savedAt: string;
  warehouseName: string;
  updatedAt: string;
  lastBackupAt?: string;
  onboardingCompleted: boolean;
  counts: Record<RowStore, number>;
};
type Positioned<T> = { position: number; row: T };
type OrderedMovement = { order: number; row: MiniState['movements'][number] };

export function openWarehouseDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      for (const name of ROW_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Database open failed'));
    request.onblocked = () => reject(new Error('Database upgrade blocked'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function validHead(value: unknown): value is Head {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Head>;
  return v.persistenceVersion === 2
    && Number.isSafeInteger(v.revision) && v.revision! >= 1
    && Number.isSafeInteger(v.movementOrder) && v.movementOrder! >= 0
    && typeof v.savedAt === 'string' && Number.isFinite(Date.parse(v.savedAt))
    && typeof v.updatedAt === 'string'
    && typeof v.warehouseName === 'string'
    && typeof v.onboardingCompleted === 'boolean'
    && !!v.counts && ROW_STORES.every(name => Number.isSafeInteger(v.counts?.[name]) && v.counts[name] >= 0);
}

function orderedRows<T>(input: unknown[]): T[] {
  const rows = input as Positioned<T>[];
  if (!rows.every(entry => entry && Number.isSafeInteger(entry.position) && entry.position >= 0 && 'row' in entry)) {
    throw new Error('STORAGE_RECOVERY_REQUIRED');
  }
  rows.sort((a, b) => a.position - b.position);
  if (rows.some((row, index) => row.position !== index)) throw new Error('STORAGE_RECOVERY_REQUIRED');
  return rows.map(entry => entry.row);
}

function orderedMovements(input: unknown[], maxOrder: number): MiniState['movements'] {
  const rows = input as OrderedMovement[];
  if (!rows.every(entry => entry && Number.isSafeInteger(entry.order) && entry.order > 0
    && entry.order <= maxOrder && 'row' in entry)) throw new Error('STORAGE_RECOVERY_REQUIRED');
  rows.sort((a, b) => b.order - a.order);
  if (rows.some((row, index) => index > 0 && row.order === rows[index - 1].order)) {
    throw new Error('STORAGE_RECOVERY_REQUIRED');
  }
  return rows.map(entry => entry.row);
}

// All stores are read in ONE transaction, so history and balances come from
// the same committed revision, even if another tab writes concurrently.
export function readWarehouseSnapshot(db: IDBDatabase): Promise<StoredSnapshot> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(ALL_STORES, 'readonly'); }
    catch (error) { reject(error); return; }
    const results: Record<string, unknown> = {};
    let firstError: unknown;
    tx.onabort = () => reject(firstError ?? tx.error ?? new Error('IndexedDB read aborted'));
    tx.onerror = () => { firstError ??= tx.error; };
    const watch = (name: string, request: IDBRequest) => {
      request.onsuccess = () => { results[name] = request.result; };
      request.onerror = () => { firstError ??= request.error; };
    };
    watch('head', tx.objectStore(LEGACY_STORE).get(HEAD_KEY));
    watch('legacy', tx.objectStore(LEGACY_STORE).get(LEGACY_KEY));
    for (const name of ROW_STORES) watch(name, tx.objectStore(name).getAll());
    tx.oncomplete = () => {
      try {
        const head = results.head;
        const raw = Object.fromEntries(ROW_STORES.map(name => [name, results[name] as unknown[]])) as Record<RowStore, unknown[]>;
        if (head == null) {
          // Missing metadata with orphaned records is corruption, not an empty
          // database and not permission to resurrect a stale v3 snapshot.
          if (ROW_STORES.some(name => raw[name].length)) throw new Error('STORAGE_RECOVERY_REQUIRED');
          resolve({ kind: 'legacy', value: results.legacy, revision: 0, movementOrder: 0 });
          return;
        }
        if (!validHead(head) || ROW_STORES.some(name => raw[name].length !== head.counts[name])) {
          throw new Error('STORAGE_RECOVERY_REQUIRED');
        }
        const state: MiniState = {
          schemaVersion: 3,
          warehouseName: head.warehouseName,
          updatedAt: head.updatedAt,
          ...(head.lastBackupAt ? { lastBackupAt: head.lastBackupAt } : {}),
          onboardingCompleted: head.onboardingCompleted,
          products: orderedRows(raw.products),
          categories: orderedRows(raw.categories),
          locations: orderedRows(raw.locations),
          balances: orderedRows(raw.balances),
          batches: orderedRows(raw.batches),
          movements: orderedMovements(raw.movements, head.movementOrder),
        };
        resolve({
          kind: 'incremental',
          value: { persistenceVersion: 1, savedAt: head.savedAt, state },
          revision: head.revision,
          movementOrder: head.movementOrder,
        });
      } catch (error) { reject(error); }
    };
  });
}

function rowKey(store: OtherStore, row: any): string {
  return store === 'balances' ? JSON.stringify([row.productId, row.locationId]) : row.id;
}

function updateRows(
  tx: IDBTransaction, storeName: OtherStore,
  before: MiniState[OtherStore] | undefined, after: MiniState[OtherStore],
): void {
  const store = tx.objectStore(storeName);
  const previous = new Map((before ?? []).map((row: any, position: number) =>
    [rowKey(storeName, row), { position, row }] as const));
  const retained = new Set<string>();
  after.forEach((row: any, position: number) => {
    const key = rowKey(storeName, row);
    retained.add(key);
    const old = previous.get(key);
    if (!old || old.position !== position || JSON.stringify(old.row) !== JSON.stringify(row)) {
      store.put({ position, row }, key);
    }
  });
  for (const key of previous.keys()) if (!retained.has(key)) store.delete(key);
}

// Return the number of prepended movements if the old history is an unchanged
// suffix. Any edit, reorder, deletion or backup restore rewrites history.
function prependedCount(before: MiniState['movements'], after: MiniState['movements']): number {
  const added = after.length - before.length;
  if (added < 0) return -1;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].id !== after[i + added].id
      || JSON.stringify(before[i]) !== JSON.stringify(after[i + added])) return -1;
  }
  return added;
}

function replaceMovements(tx: IDBTransaction, movements: MiniState['movements']): number {
  const store = tx.objectStore('movements');
  store.clear();
  for (let i = 0; i < movements.length; i += 1) {
    store.put({ order: movements.length - i, row: movements[i] }, movements[i].id);
  }
  return movements.length;
}

// Compare-and-swap revision is checked INSIDE the write transaction. All
// changes and metadata become visible together, or none of them do.
export function writeWarehouseSnapshot(
  db: IDBDatabase, envelope: StoredEnvelope, baseline: PersistedBaseline,
): Promise<{ revision: number; movementOrder: number }> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(ALL_STORES, 'readwrite'); }
    catch (error) { reject(error); return; }
    let failure: Error | null = null;
    let nextOrder = 0;
    const revision = baseline.revision + 1;
    const fail = (error: Error) => {
      failure = error;
      try { tx.abort(); } catch { /* transaction has already aborted */ }
    };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB write aborted'));
    tx.onerror = () => { failure ??= tx.error; };
    tx.oncomplete = () => resolve({ revision, movementOrder: nextOrder });

    const enqueue = (head: Head | null) => {
      try {
        if (head && head.revision !== baseline.revision) {
          fail(new Error('STORAGE_CONFLICT')); return;
        }
        if (!head && baseline.revision !== 0) {
          fail(new Error('STORAGE_CONFLICT')); return;
        }
        const before = head && baseline.state ? baseline.state : null;
        if (!before) {
          for (const name of ROW_STORES) tx.objectStore(name).clear();
        }
        for (const name of ROW_STORES.filter(name => name !== 'movements') as OtherStore[]) {
          updateRows(tx, name, before?.[name], envelope.state[name]);
        }
        const movements = envelope.state.movements;
        const added = before ? prependedCount(before.movements, movements) : -1;
        if (added < 0) {
          nextOrder = replaceMovements(tx, movements);
        } else {
          nextOrder = head!.movementOrder + added;
          for (let i = 0; i < added; i += 1) {
            tx.objectStore('movements').put({ order: nextOrder - i, row: movements[i] }, movements[i].id);
          }
        }
        const counts = Object.fromEntries(ROW_STORES.map(name => [name, envelope.state[name].length])) as Record<RowStore, number>;
        const { state, savedAt } = envelope;
        const metadata: Head = {
          persistenceVersion: 2,
          revision, movementOrder: nextOrder, savedAt,
          warehouseName: state.warehouseName, updatedAt: state.updatedAt,
          ...(state.lastBackupAt ? { lastBackupAt: state.lastBackupAt } : {}),
          onboardingCompleted: state.onboardingCompleted, counts,
        };
        tx.objectStore(LEGACY_STORE).put(metadata, HEAD_KEY);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    };

    const getHead = tx.objectStore(LEGACY_STORE).get(HEAD_KEY);
    getHead.onsuccess = () => {
      const raw = getHead.result;
      if (raw != null && !validHead(raw)) {
        fail(new Error('STORAGE_RECOVERY_REQUIRED')); return;
      }
      if (raw != null) { enqueue(raw); return; }
      // An interrupted migration cannot leave rows behind (single tx). If
      // they are present without metadata, never overwrite them silently.
      let remaining = ROW_STORES.length;
      let orphaned = false;
      for (const name of ROW_STORES) {
        const count = tx.objectStore(name).count();
        count.onsuccess = () => {
          orphaned ||= count.result > 0;
          remaining -= 1;
          if (remaining === 0) {
            if (orphaned) fail(new Error('STORAGE_RECOVERY_REQUIRED'));
            else enqueue(null);
          }
        };
      }
    };
  });
}
