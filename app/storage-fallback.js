(() => {
  const probeKey = `aardvarkland-storage-probe-${Date.now().toString(36)}`;

  try {
    const storage = window.localStorage;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return;
  } catch {
    // Continue with an in-memory Storage-compatible fallback.
  }

  const values = new Map();
  const fallback = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      const normalized = String(key);
      return values.has(normalized) ? values.get(normalized) : null;
    },
    key(index) {
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0) return null;
      return [...values.keys()][position] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: fallback,
    });
  } catch {
    // Individual application guards still handle isolated storage failures.
  }
})();
