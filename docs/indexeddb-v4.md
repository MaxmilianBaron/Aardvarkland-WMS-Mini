# IndexedDB v4 — migration, safety and performance

## On-device schema

The application remains offline-first. IndexedDB database
\`aardvarkland-mini-wms\` uses schema version **4**, with the legacy
\`state/warehouse\` document retained as a **frozen pre-migration snapshot**.

The authoritative v4 data lives in the separate object stores \`products\`,
\`categories\`, \`locations\`, \`balances\`, \`batches\` and \`movements\`.
Metadata and a monotonically increasing revision are stored at
\`state/warehouse-incremental-v1\` (the v4 activation marker).

All of these stores are read in a single readonly transaction, giving a
consistent state. All updated/deleted records, new movements and the revision
marker are written in **one readwrite transaction**. User-visible save success
is reported only after the transaction's \`complete\` event.

The public \`MiniState\` and JSON backup formats (schema versions 1, 2 and 3)
remain unchanged; the application still exports and restores full histories.

## Upgrade and recovery

1. The database schema upgrade creates empty v4 stores. The old document is
   never deleted during that step.
2. On the first writable load, the v3 envelope or raw state is normalized and
   validated using the existing strict stock, batch, reference and uniqueness
   rules. A single readwrite transaction populates v4 stores and commits the
   activation marker. Read-only tabs do not initiate migration.
3. A failed, aborted or quota-limited migration leaves the old v3 record
   authoritative, intact and retryable at the next writable load. Until the
   marker commits, v4 rows must be empty.
4. Once a v4 marker exists, **only v4 is authoritative**. The frozen legacy
   snapshot is never automatically used for recovery, because it may be stale.
   Missing/corrupt metadata or orphaned rows fail closed rather than resetting
   the warehouse or silently reverting to old stock.
5. A locally saved fallback may be repaired into a healthy v4 database if it
   represents a newer acknowledged save. The fallback is removed only after
   transaction completion. If IndexedDB is unavailable, the existing
   localStorage fallback is attempted; if it also fails (e.g. quota), the save
   rejects, and the UI must show the unsaved state.
6. Write transactions validate the expected metadata revision *inside the
   transaction*, rejecting stale concurrent writers with \`STORAGE_CONFLICT\`.
   These conflicts are **not** converted into fallback writes that might
   later overwrite an updated warehouse. The UI's existing Web Lock still
   makes other tabs read-only when available.

**Rollback limitation:** An old application that requests IndexedDB version 3
cannot open an already-upgraded version 4 database (\`VersionError\`).
Automatically supporting two independently running versions without risk of
stale writes is not possible. Before downgrading, export a **v3 JSON backup**
with the updated app, install the older build, reset its isolated storage only
after securing an external backup, and import the JSON. Older app versions
must not be relied upon to open migrated profiles. Retaining the frozen v3
snapshot is a recovery safeguard, **not** a live mirror of v4.

Never delete IndexedDB data or clear browser/Android app storage to "fix"
an upgrade without first exporting and verifying a backup. Test the migration
and restore on a copy of actual device data before broad rollout. Browser
storage is not a substitute for independent backups. PIN protection does
not encrypt at-rest or exported data.

## Incremental write model

Each master-data/balance/batch record is keyed separately and updated only
if its contents or collection position change. Normal stock movements add
an immutable movement at the beginning of the chronological history. The
persisted ordering counter assigns each new record an increasing order,
allowing **one new movement write** rather than re-putting all preceding
movements. A backup restore, a movement edit, reordering or deletion uses a
full **transactional replacement** of the history instead of applying an
unsafe append optimization.

The public API still strictly normalizes and validates the complete
\`MiniState\` before saving. This is intentional: v4 minimizes IndexedDB write
amplification, but validation and UI state creation can still take O(N)
time/memory for N movements. True streaming domain state and pagination would
be a separate future change. The objective here is safer record-level
persistence, **not** a claim of constant-time end-to-end saves.

## Tests

\`\`\`bash
npm ci
npm run typecheck
npm test
npm run build
\`\`\`

The storage behavior suite covers old raw and enveloped snapshots, decimal
batches, interrupted migration, atomic transaction abort, fallback recovery,
dual-storage failure, revision conflict, metadata corruption, ordered
history replacement, and single-record history append with 2,000 records.
The browser UI workflow exercises Chromium's **real** IndexedDB and offline
save/restore path, not just a simulated transaction API.

## Reproducible browser benchmark

Requires the project's Node.js version, Chromium and Playwright (the e2e
lockfile pins the version).

\`\`\`bash
npm ci
npm ci --prefix e2e --ignore-scripts
node e2e/node_modules/@playwright/test/cli.js install chromium
npm run benchmark:storage > storage-benchmark.json
\`\`\`

Optional settings:

\`\`\`bash
BENCH_COUNTS=10000,50000 BENCH_SAMPLES=7 npm run benchmark:storage
\`\`\`

The benchmark starts a local Vite dev server and uses separate clean Chromium
profiles for each case. For 10,000 and 50,000 synthetic historical movements
it seeds a v3 document and compares median, minimum, maximum and individual
durable-write times for:

- **v3:** strict normalization plus full \`state/warehouse\` IndexedDB put;
- **v4:** strict normalization via the current API plus incremental IndexedDB
  transaction, followed by a record-count consistency check.

It also records the initial v3→v4 migration time separately. Results are
printed as machine-readable JSON, including the Chromium version and
fixture size. Timing results are device-dependent; run multiple iterations
on target hardware. The measured v3 path is an explicit reimplementation
of the prior write shape, **not** execution of a pinned historical app binary.
No production-data speedup has been asserted without measurements.

**Acceptance gate:** CI green, browser migration/rollback checks, verified
external backup+restore from a real representative device, and reviewed
benchmark data. Do not auto-merge before these safety checks.
