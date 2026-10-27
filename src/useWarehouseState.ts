import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emptyMiniState } from './domain';
import { getStorageBackend, loadMiniState, saveMiniState } from './storage';
import type { MiniState } from './types';
import { previewWarehouse } from './previewData';
import { normalizeQuantity } from './quantity';

export function useWarehouseState() {
  const [state, renderState] = useState<MiniState>(emptyMiniState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const writable = useRef(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [storageBackend, setStorageBackend] = useState(getStorageBackend);
  const lastSave = useRef<Promise<boolean>>(Promise.resolve(true));
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    mounted.current = true;
    const load = async (canWrite: boolean) => {
      if (cancelled) return;
      writable.current = canWrite;
      setReadOnly(!canWrite);
      let loaded: MiniState;
      try {
        loaded = await loadMiniState(!canWrite);
        for (const row of [...loaded.balances, ...loaded.batches]) normalizeQuantity(row.quantity);
      } catch {
        if (!cancelled) { setLoadError(true); setReady(true); }
        return;
      }
      if (cancelled) return;
      if (canWrite && import.meta.env.MODE === 'public-preview' && !loaded.warehouseName
        && !loaded.products.length && !loaded.locations.length && !loaded.movements.length) {
        loaded = previewWarehouse();
        try { await saveMiniState(loaded); } catch { if (!cancelled) setSaveStatus('error'); }
      }
      if (cancelled) return;
      writable.current = canWrite;
      setReadOnly(!canWrite);
      current.current = loaded;
      renderState(loaded);
      setStorageBackend(getStorageBackend());
      setReady(true);
    };
    if (navigator.locks) {
      void navigator.locks.request('aardvarkland-mini-warehouse-writer', { ifAvailable: true }, async (lock) => {
        if (cancelled) return;
        if (!lock) { await load(false); return; }
        const held = new Promise<void>((resolve) => { release = resolve; });
        await load(true);
        await held;
      }).catch(() => { if (!cancelled) void load(false); });
    } else {
      // Without cross-window locking, do not risk overwriting another snapshot.
      void load(false);
    }
    return () => { cancelled = true; mounted.current = false; writable.current = false; release?.(); };
  }, []);

  const setState: Dispatch<SetStateAction<MiniState>> = useCallback((update) => {
    if (!writable.current) { lastSave.current = Promise.resolve(false); return; }
    const next = typeof update === 'function' ? update(current.current) : update;
    if (next === current.current) return;
    const ownRevision = ++revision.current;
    current.current = next;
    renderState(next);
    setSaveStatus('saving');
    // Start persistence immediately, not on an 80 ms UI debounce. The storage
    // module serializes writes and resolves only after the transaction commits.
    lastSave.current = Promise.resolve().then(() => saveMiniState(next)).then((backend) => {
      if (mounted.current && ownRevision === revision.current) {
        setStorageBackend(backend);
        setSaveStatus('saved');
      }
      return true;
    }).catch(() => {
      if (mounted.current && ownRevision === revision.current) setSaveStatus('error');
      return false;
    });
  }, []);

  const afterSave = useCallback((callback: () => void) => {
    const ownRevision = revision.current;
    void lastSave.current.then((saved) => { if (saved && mounted.current && ownRevision === revision.current) callback(); });
  }, []);
  const retrySave = useCallback(() => setState({ ...current.current }), [setState]);
  const recoverFromBackup = useCallback(async (next: MiniState) => {
    if (!writable.current) return false;
    for (const row of [...next.balances, ...next.batches]) normalizeQuantity(row.quantity);
    setState(next);
    const saved = await lastSave.current;
    if (saved && mounted.current) setLoadError(false);
    return saved;
  }, [setState]);

  useEffect(() => {
    if (saveStatus === 'saved') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveStatus]);

  return { state, setState, ready, loadError, storageBackend, saveStatus, afterSave, retrySave, recoverFromBackup, readOnly };
}
