import assert from 'node:assert/strict';
import test from 'node:test';

import { getStorageBackend, loadMiniState, parseMiniBackup, saveMiniState } from '../src/storage.ts';

const FALLBACK_KEY = 'aardvarkland-mini-wms-state-v3';

function miniState(warehouseName, updatedAt) {
  return {
    schemaVersion: 3,
    warehouseName,
    products: [],
    categories: [],
    batches: [],
    locations: [],
    balances: [],
    movements: [],
    onboardingCompleted: false,
    updatedAt,
  };
}

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

// A transactional IDB simulation: reads see committed records, readwrite
// changes are isolated until commit, and abort never publishes partial rows.
// The browser e2e suite exercises the real Chromium implementation as well.
function createIndexedDbHarness() {
  const stores = new Map([['state', new Map()]]);
  let version = 3;
  let failOpen = false;
  let abortNext = false;
  let holdNextWrite = false;
  let heldCommit = null;
  let heldWritePromise = null;
  let heldWriteResolve = null;
  let writeStarts = 0;
  let readwriteStarts = 0;
  const puts = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const keyOf = key => JSON.stringify(key);
  const entries = name => [...stores.get(name).values()].map(clone);

  function makeTransaction(names, mode) {
    if (mode === 'readwrite') readwriteStarts += 1;
    const selected = Array.isArray(names) ? names : [names];
    const working = new Map(selected.map(name => {
      if (!stores.has(name)) throw new Error('No such store: ' + name);
      return [name, new Map([...stores.get(name)].map(([key, value]) => [key, clone(value)]))];
    }));
    let pending = 0, finished = false;
    const transaction = {
      error: null, oncomplete: null, onerror: null, onabort: null,
      abort() {
        if (finished) return;
        finished = true;
        queueMicrotask(() => transaction.onabort?.());
      },
      objectStore(name) {
        if (!working.has(name)) throw new Error('Store not in transaction: ' + name);
        const map = working.get(name);
        return {
          get(key) { return request(() => clone(map.get(keyOf(key)))); },
          getAll() { return request(() => [...map.values()].map(clone)); },
          count() { return request(() => map.size); },
          put(value, key) {
            if (mode !== 'readwrite') throw new Error('read-only transaction');
            return request(() => {
              map.set(keyOf(key), clone(value));
              puts.set(name, (puts.get(name) ?? 0) + 1);
              return key;
            }, true);
          },
          delete(key) {
            if (mode !== 'readwrite') throw new Error('read-only transaction');
            return request(() => map.delete(keyOf(key)));
          },
          clear() {
            if (mode !== 'readwrite') throw new Error('read-only transaction');
            return request(() => map.clear());
          },
        };
      },
    };

    function maybeCommit() {
      if (pending || finished) return;
      queueMicrotask(() => {
        if (pending || finished) return;
        finished = true;
        if (mode === 'readwrite' && abortNext) {
          abortNext = false;
          transaction.error = new Error('simulated transaction abort');
          transaction.onabort?.();
          return;
        }
        if (mode === 'readwrite') for (const [name, map] of working) stores.set(name, map);
        transaction.oncomplete?.();
      });
    }

    function request(operation, isPut = false) {
      const result = { result: undefined, error: null, onsuccess: null, onerror: null };
      pending += 1;
      const execute = () => {
        if (finished) return;
        try {
          result.result = operation();
          result.onsuccess?.();
        } catch (error) {
          result.error = error;
          transaction.error = error;
          result.onerror?.();
          transaction.onerror?.();
          transaction.abort();
        }
        pending -= 1;
        maybeCommit();
      };
      queueMicrotask(() => {
        if (isPut) {
          writeStarts += 1;
          if (holdNextWrite) {
            holdNextWrite = false;
            heldCommit = execute;
            heldWriteResolve?.();
            return;
          }
        }
        execute();
      });
      return result;
    }
    queueMicrotask(maybeCommit);
    return transaction;
  }

  const indexedDB = {
    open(_name, wantedVersion) {
      const request = {
        result: undefined, error: null, onupgradeneeded: null,
        onsuccess: null, onerror: null, onblocked: null,
      };
      queueMicrotask(() => {
        if (failOpen) {
          request.error = new Error('simulated IndexedDB outage');
          request.onerror?.();
          return;
        }
        const database = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore(name) {
            if (stores.has(name)) throw new Error('Store already exists');
            stores.set(name, new Map());
          },
          transaction: makeTransaction,
          close() {},
          onversionchange: null,
        };
        request.result = database;
        if (wantedVersion > version) {
          version = wantedVersion;
          request.onupgradeneeded?.();
        } else if (wantedVersion < version) {
          request.error = new Error('VersionError');
          request.onerror?.();
          return;
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    indexedDB,
    fail() { failOpen = true; },
    recover() { failOpen = false; },
    seed(value) { stores.get('state').set(keyOf('warehouse'), clone(value)); },
    readLegacy() { return clone(stores.get('state').get(keyOf('warehouse'))); },
    storeRows(name) { return entries(name); },
    head() { return clone(stores.get('state').get(keyOf('warehouse-incremental-v1'))); },
    removeHead() { stores.get('state').delete(keyOf('warehouse-incremental-v1')); },
    bumpRevision() {
      const key = keyOf('warehouse-incremental-v1');
      const head = clone(stores.get('state').get(key));
      head.revision += 1;
      stores.get('state').set(key, head);
    },
    readStored() {
      const head = this.head();
      if (!head) return this.readLegacy();
      const array = name => entries(name).sort((a, b) => a.position - b.position).map(v => v.row);
      return {
        persistenceVersion: 1, savedAt: head.savedAt,
        state: {
          schemaVersion: 3,
          warehouseName: head.warehouseName, updatedAt: head.updatedAt,
          onboardingCompleted: head.onboardingCompleted, lastBackupAt: head.lastBackupAt,
          products: array('products'), categories: array('categories'),
          locations: array('locations'), balances: array('balances'),
          batches: array('batches'),
          movements: entries('movements').sort((a, b) => b.order - a.order).map(v => v.row),
        },
      };
    },
    abortNextTransaction() { abortNext = true; },
    holdNextWrite() {
      if (heldCommit) throw new Error('a write is already held');
      holdNextWrite = true;
      heldWritePromise = new Promise(resolve => { heldWriteResolve = resolve; });
    },
    waitForHeldWrite() {
      if (!heldWritePromise) throw new Error('no held write was requested');
      return heldWritePromise;
    },
    releaseHeldWrite() {
      if (!heldCommit) throw new Error('held write has not started');
      const commit = heldCommit;
      heldCommit = null;
      heldWritePromise = null;
      heldWriteResolve = null;
      commit();
    },
    writeCount() { return writeStarts; },
    transactionCount() { return readwriteStarts; },
    putCount(name) { return puts.get(name) ?? 0; },
  };
}

function installBrowserStorage() {
  const localStorage = createLocalStorage();
  const indexedDbHarness = createIndexedDbHarness();
  globalThis.window = { localStorage };
  globalThis.indexedDB = indexedDbHarness.indexedDB;
  return { localStorage, indexedDbHarness };
}

function removeBrowserStorage() {
  delete globalThis.window;
  delete globalThis.indexedDB;
}

test('newer fallback survives temporary IndexedDB failure and repairs primary storage on recovery', async () => {
  const { localStorage, indexedDbHarness } = installBrowserStorage();
  try {
    const primary = miniState('Primary before outage', '2026-08-17T12:00:00.000Z');
    assert.equal(await saveMiniState(primary), 'indexeddb');

    indexedDbHarness.fail();
    // A restored backup may legitimately have an older domain updatedAt even
    // though the restore itself is the newest user action. Reconciliation must
    // therefore use the storage write timestamp, not MiniState.updatedAt.
    const restoredDuringOutage = miniState('Restored during outage', '2026-01-01T00:00:00.000Z');
    assert.equal(await saveMiniState(restoredDuringOutage), 'localStorage');
    assert.ok(localStorage.getItem(FALLBACK_KEY));

    indexedDbHarness.recover();
    const loaded = await loadMiniState();

    assert.equal(loaded.warehouseName, 'Restored during outage');
    assert.equal(getStorageBackend(), 'indexeddb');
    assert.equal(localStorage.getItem(FALLBACK_KEY), null);
    assert.equal(indexedDbHarness.readStored().state.warehouseName, 'Restored during outage');
  } finally {
    removeBrowserStorage();
  }
});

test('older legacy fallback cannot overwrite a newer healthy IndexedDB snapshot', async () => {
  const { localStorage } = installBrowserStorage();
  try {
    const primary = miniState('Current primary', '2026-08-17T12:00:00.000Z');
    assert.equal(await saveMiniState(primary), 'indexeddb');

    localStorage.setItem(FALLBACK_KEY, JSON.stringify(miniState('Stale fallback', '2026-07-01T00:00:00.000Z')));
    const loaded = await loadMiniState();

    assert.equal(loaded.warehouseName, 'Current primary');
    assert.equal(localStorage.getItem(FALLBACK_KEY), null);
    assert.equal(getStorageBackend(), 'indexeddb');
  } finally {
    removeBrowserStorage();
  }
});

test('valid fallback repairs a corrupt IndexedDB snapshot instead of being discarded', async () => {
  const { localStorage, indexedDbHarness } = installBrowserStorage();
  try {
    indexedDbHarness.seed({ schemaVersion: 999, warehouseName: 'corrupt-primary' });
    localStorage.setItem(
      FALLBACK_KEY,
      JSON.stringify(miniState('Valid fallback', '2026-08-17T12:00:00.000Z')),
    );

    const loaded = await loadMiniState();

    assert.equal(loaded.warehouseName, 'Valid fallback');
    assert.equal(getStorageBackend(), 'indexeddb');
    assert.equal(localStorage.getItem(FALLBACK_KEY), null);
    assert.equal(indexedDbHarness.readStored().state.warehouseName, 'Valid fallback');
  } finally {
    removeBrowserStorage();
  }
});

test('failure to remove stale localStorage does not downgrade a successful IndexedDB save', async () => {
  const { localStorage } = installBrowserStorage();
  const originalRemoveItem = localStorage.removeItem;
  try {
    localStorage.removeItem = () => { throw new Error('localStorage cleanup blocked'); };
    const state = miniState('IndexedDB remains primary', '2026-08-17T12:00:00.000Z');

    assert.equal(await saveMiniState(state), 'indexeddb');
    assert.equal(getStorageBackend(), 'indexeddb');
  } finally {
    localStorage.removeItem = originalRemoveItem;
    removeBrowserStorage();
  }
});

test('overlapping saves commit in invocation order so an older slow write cannot overwrite newer state', async () => {
  const { indexedDbHarness } = installBrowserStorage();
  try {
    indexedDbHarness.holdNextWrite();
    const older = miniState('Older state', '2026-08-17T12:00:00.000Z');
    const newer = miniState('Newer state', '2026-08-17T12:00:01.000Z');

    const firstSave = saveMiniState(older);
    await indexedDbHarness.waitForHeldWrite();
    const secondSave = saveMiniState(newer);

    // Give an un-serialized implementation a chance to start/commit save #2
    // while save #1 is still held. The fixed implementation keeps it queued.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(indexedDbHarness.transactionCount(), 1);

    indexedDbHarness.releaseHeldWrite();
    assert.deepEqual(await Promise.all([firstSave, secondSave]), ['indexeddb', 'indexeddb']);
    assert.equal(indexedDbHarness.transactionCount(), 2);
    assert.equal(indexedDbHarness.readStored().state.warehouseName, 'Newer state');
  } finally {
    removeBrowserStorage();
  }
});

test('valid decimal lots 0.1 + 0.2 persist with aggregate stock 0.3', async () => {
  const { indexedDbHarness } = installBrowserStorage();
  try {
    const saved = miniState('Decimal lots', '2026-10-27T00:00:00.000Z');
    saved.products = [{
      id: 'p', sku: 'P', name: 'Product', barcode: '', unit: 'kg',
      minimumStock: 0, categoryId: null, createdAt: saved.updatedAt, updatedAt: saved.updatedAt,
    }];
    saved.locations = [{ id: 'l', code: 'L', name: 'Location', createdAt: saved.updatedAt }];
    saved.balances = [{ productId: 'p', locationId: 'l', quantity: 0.3 }];
    saved.batches = [0.1, 0.2].map((quantity, index) => ({
      id: 'batch-' + index, productId: 'p', locationId: 'l',
      lotNumber: 'lot-' + index, expiryDate: null,
      quantity, createdAt: saved.updatedAt, updatedAt: saved.updatedAt,
    }));
    assert.equal(await saveMiniState(saved), 'indexeddb');
    const loaded = await loadMiniState();
    assert.equal(loaded.batches.length, 2);
    assert.equal(loaded.balances[0].quantity, 0.3);
    assert.ok(indexedDbHarness.readStored());
  } finally { removeBrowserStorage(); }
});

test('unavailable IndexedDB without a backup fails closed, preserving existing stock', async () => {
  const { indexedDbHarness } = installBrowserStorage();
  try {
    indexedDbHarness.seed(miniState('Existing warehouse', '2026-10-27T00:00:00.000Z'));
    indexedDbHarness.fail();
    await assert.rejects(loadMiniState(), /STORAGE_RECOVERY_REQUIRED/);
    indexedDbHarness.recover();
    assert.equal((await loadMiniState()).warehouseName, 'Existing warehouse');
  } finally { removeBrowserStorage(); }
});

function historyState(count, name = 'History') {
  const state = miniState(name, '2026-10-27T12:00:00.000Z');
  state.products = [{
    id: 'p', sku: 'P', name: 'Product', barcode: '', unit: 'kg',
    minimumStock: 0, categoryId: null, createdAt: state.updatedAt, updatedAt: state.updatedAt,
  }];
  state.locations = [{ id: 'l', code: 'L', name: 'Location', createdAt: state.updatedAt }];
  state.balances = [{ productId: 'p', locationId: 'l', quantity: 1 }];
  state.movements = Array.from({ length: count }, (_, i) => movement('m-' + i));
  state.onboardingCompleted = true;
  return state;
}

function movement(id) {
  return {
    id, type: 'RECEIPT', productId: 'p',
    fromLocationId: null, toLocationId: 'l',
    quantity: 1, delta: 1, note: id,
    batchId: null, lotNumber: '', expiryDate: null,
    createdAt: '2026-10-27T12:00:00.000Z',
  };
}

test('v3 raw warehouse migrates atomically while preserving its original record and movement order', async () => {
  const { indexedDbHarness: idb } = installBrowserStorage();
  try {
    const legacy = { ...historyState(6), schemaVersion: 1 };
    idb.seed(legacy);
    const loaded = await loadMiniState();
    assert.equal(loaded.schemaVersion, 3);
    assert.deepEqual(loaded.movements.map(m => m.id), legacy.movements.map(m => m.id));
    assert.deepEqual(loaded.balances, legacy.balances);
    assert.equal(idb.head().persistenceVersion, 2);
    assert.equal(idb.head().revision, 1);
    assert.equal(idb.storeRows('movements').length, 6);
    assert.deepEqual(idb.readLegacy(), legacy, 'migration must not destroy the original');
    assert.deepEqual((await loadMiniState()).movements, loaded.movements);
  } finally { removeBrowserStorage(); }
});

test('the large history fast path writes only the prepended movement, not the old records', async () => {
  const { indexedDbHarness: idb } = installBrowserStorage();
  try {
    const initial = historyState(2000);
    assert.equal(await saveMiniState(initial), 'indexeddb');
    const before = idb.putCount('movements');
    const changed = {
      ...initial, warehouseName: 'One more receipt',
      movements: [movement('latest'), ...initial.movements],
    };
    assert.equal(await saveMiniState(changed), 'indexeddb');
    assert.equal(idb.putCount('movements') - before, 1);
    assert.equal(idb.storeRows('movements').length, 2001);
    assert.equal((await loadMiniState()).movements[0].id, 'latest');
    assert.equal((await loadMiniState()).movements.at(-1).id, 'm-1999');
  } finally { removeBrowserStorage(); }
});

test('abort during migration retains the complete v3 source and is safe to retry', async () => {
  const { indexedDbHarness: idb } = installBrowserStorage();
  try {
    const source = historyState(30);
    idb.seed({ persistenceVersion: 1, savedAt: source.updatedAt, state: source });
    idb.abortNextTransaction();
    const served = await loadMiniState();
    assert.equal(served.movements.length, 30);
    assert.equal(idb.head(), undefined);
    assert.deepEqual(idb.readLegacy().state, source);
    assert.equal(idb.storeRows('movements').length, 0);
    const repaired = await loadMiniState();
    assert.equal(repaired.movements.length, 30);
    assert.equal(idb.head().revision, 1);
  } finally { removeBrowserStorage(); }
});

test('aborted multi-store save is all-or-nothing; local fallback replays after recovery', async () => {
  const { indexedDbHarness: idb, localStorage } = installBrowserStorage();
  try {
    const first = historyState(4);
    await saveMiniState(first);
    idb.abortNextTransaction();
    const second = { ...first, warehouseName: 'Recovered change', movements: [movement('new'), ...first.movements] };
    assert.equal(await saveMiniState(second), 'localStorage');
    assert.ok(localStorage.getItem(FALLBACK_KEY));
    assert.equal(idb.head().revision, 1, 'aborted revision must not publish');
    assert.equal(idb.storeRows('movements').length, 4, 'aborted movement must not publish');
    const recovered = await loadMiniState();
    assert.equal(recovered.warehouseName, 'Recovered change');
    assert.equal(recovered.movements[0].id, 'new');
    assert.equal(idb.head().revision, 2);
    assert.equal(idb.storeRows('movements').length, 5);
    assert.equal(localStorage.getItem(FALLBACK_KEY), null);
  } finally { removeBrowserStorage(); }
});

test('failed IndexedDB and full localStorage quota never report success', async () => {
  const { indexedDbHarness: idb, localStorage } = installBrowserStorage();
  const original = localStorage.setItem;
  try {
    const first = historyState(2);
    await saveMiniState(first);
    idb.abortNextTransaction();
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    await assert.rejects(saveMiniState({ ...first, movements: [movement('unsaved'), ...first.movements] }), /QuotaExceededError/);
    assert.equal(idb.storeRows('movements').length, 2);
    assert.equal(idb.head().revision, 1);
  } finally {
    localStorage.setItem = original;
    removeBrowserStorage();
  }
});

test('cross-tab revision conflict is rejected, not mirrored into localStorage', async () => {
  const { indexedDbHarness: idb, localStorage } = installBrowserStorage();
  try {
    const first = historyState(2);
    await saveMiniState(first);
    idb.bumpRevision(); // Model another writer committing a newer revision.
    await assert.rejects(
      saveMiniState({ ...first, warehouseName: 'Stale writer' }),
      /STORAGE_CONFLICT/,
    );
    assert.equal(localStorage.getItem(FALLBACK_KEY), null);
    assert.equal(idb.readStored().state.warehouseName, 'History');
  } finally { removeBrowserStorage(); }
});

test('orphaned v4 rows without metadata fail closed instead of resurrecting stale v3', async () => {
  const { indexedDbHarness: idb } = installBrowserStorage();
  try {
    const source = historyState(5);
    idb.seed(source);
    await loadMiniState();
    idb.removeHead();
    await assert.rejects(loadMiniState(), /STORAGE_RECOVERY_REQUIRED/);
    assert.deepEqual(idb.readLegacy(), source);
    assert.equal(idb.storeRows('movements').length, 5);
  } finally { removeBrowserStorage(); }
});

test('restore, deletion and reorder replace the history and do not revive discarded rows', async () => {
  const { indexedDbHarness: idb } = installBrowserStorage();
  try {
    const first = historyState(6);
    await saveMiniState(first);
    const restored = { ...first, movements: [first.movements[5], first.movements[2], first.movements[0]] };
    await saveMiniState(restored);
    assert.deepEqual((await loadMiniState()).movements.map(m => m.id), ['m-5', 'm-2', 'm-0']);
    assert.equal(idb.storeRows('movements').length, 3);
    assert.deepEqual(parseMiniBackup(idb.readStored().state).movements.map(m => m.id), ['m-5', 'm-2', 'm-0']);
  } finally { removeBrowserStorage(); }
});
