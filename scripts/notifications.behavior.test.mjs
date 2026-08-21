import assert from 'node:assert/strict';
import test from 'node:test';

import { disableNotifications, notificationsEnabled, notifyExpiry } from '../src/notifications.ts';
import { emptyMiniState } from '../src/domain.ts';

function throwingStorage() {
  return {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); },
    removeItem() { throw new Error('storage blocked'); },
  };
}

test('blocked localStorage cannot crash notification preference reads or writes', () => {
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = throwingStorage();
    assert.equal(notificationsEnabled(), false);
    assert.doesNotThrow(() => disableNotifications());
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('web notification check stays a no-op even when storage is unavailable', async () => {
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = throwingStorage();
    await assert.doesNotReject(notifyExpiry(emptyMiniState(), 'cs'));
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
