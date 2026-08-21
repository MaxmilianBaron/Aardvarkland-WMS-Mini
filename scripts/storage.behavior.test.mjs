import assert from 'node:assert/strict';
import test from 'node:test';

import { getStorageBackend, loadMiniState, saveMiniState } from '../src/storage.ts';

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

function createIndexedDbHarness() {
  let storedValue;
  let failOpen = false;
  let holdNextWrite = false;
  let heldCommit = null;
  let heldWritePromise = null;
  let heldWriteResolve = null;
  let writeStarts = 0;

  const indexedDB = {
    open() {
      const request = {
        result: undefined,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (failOpen) {
          request.error = new Error('simulated IndexedDB outage');
          request.onerror?.();
          return;
        }

        const database = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          close() {},
          transaction() {
            const transaction = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  get() {
                    const readRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      readRequest.result = storedValue === undefined ? undefined : structuredClone(storedValue);
                      readRequest.onsuccess?.();
                    });
                    return readRequest;
                  },
                  put(value) {
                    writeStarts += 1;
                    const commit = () => {
                      storedValue = structuredClone(value);
                      queueMicrotask(() => transaction.oncomplete?.());
                    };
                    if (holdNextWrite) {
                      holdNextWrite = false;
                      heldCommit = commit;
                      heldWriteResolve?.();
                      return;
                    }
                    queueMicrotask(commit);
                  },
                };
              },
            };
            return transaction;
          },
        };

        request.result = database;
        request.onsuccess?.();
      });

      return request;
    },
  };

  return {
    indexedDB,
    fail() { failOpen = true; },
    recover() { failOpen = false; },
    seed(value) { storedValue = structuredClone(value); },
    readStored() { return storedValue === undefined ? undefined : structuredClone(storedValue); },
    holdNextWrite() {
      if (heldCommit) throw new Error('a write is already held');
      holdNextWrite = true;
      heldWritePromise = new Promise((resolve) => { heldWriteResolve = resolve; });
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
    assert.equal(indexedDbHarness.writeCount(), 1);

    indexedDbHarness.releaseHeldWrite();
    assert.deepEqual(await Promise.all([firstSave, secondSave]), ['indexeddb', 'indexeddb']);
    assert.equal(indexedDbHarness.writeCount(), 2);
    assert.equal(indexedDbHarness.readStored().state.warehouseName, 'Newer state');
  } finally {
    removeBrowserStorage();
  }
});
