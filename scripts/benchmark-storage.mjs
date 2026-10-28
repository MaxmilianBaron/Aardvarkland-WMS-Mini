#!/usr/bin/env node
// Real Chromium IndexedDB benchmark, not a mocked transaction counter.
// BENCH_COUNTS=10000,50000 BENCH_SAMPLES=7 npm run benchmark:storage
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromE2e = createRequire(resolve(projectRoot, 'e2e/package.json'));
const { chromium } = requireFromE2e('@playwright/test');
const counts = (process.env.BENCH_COUNTS || '10000,50000').split(',').map(Number);
const samples = Number(process.env.BENCH_SAMPLES || 7);
if (counts.some(n => !Number.isSafeInteger(n) || n < 10000 || n > 250000)
  || !Number.isSafeInteger(samples) || samples < 3 || samples > 100) {
  throw new Error('Use BENCH_COUNTS (10,000–250,000) and BENCH_SAMPLES (3–100).');
}
const url = 'http://127.0.0.1:4010/scripts/benchmark.html';
const server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: projectRoot, stdio: 'ignore',
});
let browser;

async function awaitServer() {
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) throw new Error('Vite server exited unexpectedly.');
    try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not become ready on http://127.0.0.1:4010');
}

async function runCase(count, kind) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    return await page.evaluate(async ({ count, samples, kind }) => {
      const timestamp = '2026-10-27T12:00:00.000Z';
      const movement = id => ({
        id, type: 'RECEIPT', productId: 'p', fromLocationId: null,
        toLocationId: 'l', quantity: 1, delta: 1, note: id,
        batchId: null, lotNumber: '', expiryDate: null, createdAt: timestamp,
      });
      const state = {
        schemaVersion: 3, warehouseName: 'Reproducible benchmark',
        products: [{
          id: 'p', sku: 'P', name: 'Product', barcode: '', unit: 'kg',
          minimumStock: 0, categoryId: null, createdAt: timestamp, updatedAt: timestamp,
        }],
        categories: [], batches: [],
        locations: [{ id: 'l', code: 'L', name: 'Location', createdAt: timestamp }],
        balances: [{ productId: 'p', locationId: 'l', quantity: 1 }],
        movements: Array.from({ length: count }, (_, index) => movement('initial-' + index)),
        onboardingCompleted: true, updatedAt: timestamp,
      };
      const open = version => new Promise((resolve, reject) => {
        const request = indexedDB.open('aardvarkland-mini-wms', version);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Upgrade blocked'));
      });
      const putLegacy = (db, snapshot) => new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({
          persistenceVersion: 1, savedAt: new Date().toISOString(), state: snapshot,
        }, 'warehouse');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error ?? new Error('Aborted legacy write'));
        tx.onerror = () => reject(tx.error ?? new Error('Legacy write failed'));
      });
      const api = await import('/src/storage.ts');
      const database = await open(3);
      await putLegacy(database, state);
      const bytes = JSON.stringify(state).length;
      const timings = [];
      let migrationMs = null;
      let current = state;

      if (kind === 'legacy-v3') {
        for (let i = 0; i < samples; i += 1) {
          current = { ...current, movements: [movement('added-' + i), ...current.movements] };
          const start = performance.now();
          // Exactly the same backup normalization/invariant validation as the
          // new saveMiniState API, followed by the old full-document IDB put.
          await putLegacy(database, api.parseMiniBackup(current));
          timings.push(performance.now() - start);
        }
        database.close();
      } else {
        database.close();
        const start = performance.now();
        current = await api.loadMiniState(); // upgrade and atomic v3→v4 migration
        migrationMs = performance.now() - start;
        for (let i = 0; i < samples; i += 1) {
          current = { ...current, movements: [movement('added-' + i), ...current.movements] };
          const t0 = performance.now();
          const backend = await api.saveMiniState(current);
          if (backend !== 'indexeddb') throw new Error('Unexpected fallback: ' + backend);
          timings.push(performance.now() - t0);
        }
        const verifyDb = await open(4);
        await new Promise((resolve, reject) => {
          const tx = verifyDb.transaction(['state', 'movements'], 'readonly');
          const head = tx.objectStore('state').get('warehouse-incremental-v1');
          const rows = tx.objectStore('movements').count();
          tx.oncomplete = () => {
            if (head.result?.revision !== samples + 1 || rows.result !== count + samples) {
              reject(new Error('Committed record counts do not match expected history'));
            } else resolve();
          };
          tx.onabort = () => reject(tx.error);
        });
        verifyDb.close();
      }
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];
      return {
        kind, initialMovements: count, sampleWrites: samples, jsonBytes: bytes,
        migrationMs, medianWriteMs: median,
        minWriteMs: timings[0], maxWriteMs: timings.at(-1),
        sortedSamplesMs: timings,
      };
    }, { count, samples, kind });
  } finally {
    await context.close();
  }
}

try {
  await awaitServer();
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const count of counts) {
    results.push(await runCase(count, 'legacy-v3'));
    results.push(await runCase(count, 'incremental-v4'));
  }
  process.stdout.write(JSON.stringify({
    benchmark: 'WMS-Mini v3 full document vs v4 incremental IDB',
    browser: browser.version(),
    node: process.version, counts, samples,
    method: 'separate clean browser contexts, real Chromium, identical normalization, committed writes',
    results,
  }, null, 2) + '\n');
} finally {
  await browser?.close();
  server.kill();
}
