import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { copyFor } from './i18n';
import type { Language, MiniState } from './types';

const enabledKey = 'aardvarkland-mini-expiry-notifications';
const legacyEnabledKey = 'aardvarkland-mini-low-stock-notifications';
const fingerprintKey = 'aardvarkland-mini-expiry-fingerprint';

export function notificationsEnabled(): boolean {
  return (safeStorageGet(enabledKey) ?? safeStorageGet(legacyEnabledKey)) === 'true';
}

export async function enableNotifications(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
    const ok = status.display === 'granted';
    safeStorageSet(enabledKey, String(ok));
    return ok;
  } catch {
    safeStorageSet(enabledKey, 'false');
    return false;
  }
}

export function disableNotifications(): void {
  safeStorageSet(enabledKey, 'false');
}

export async function notifyExpiry(state: MiniState, language: Language): Promise<void> {
  if (!Capacitor.isNativePlatform() || !notificationsEnabled()) return;

  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const due = state.batches.filter(
    (batch) => batch.quantity > 0 && batch.expiryDate && batch.expiryDate <= limit,
  );
  const fingerprint = `${language}|${today}|${due
    .map((batch) => `${batch.id}:${batch.expiryDate}:${batch.quantity}`)
    .sort()
    .join('|')}`;

  if (!due.length || fingerprint === safeStorageGet(fingerprintKey)) return;

  const copy = copyFor(language);
  const expired = due.filter((batch) => batch.expiryDate! < today);
  const relevant = expired.length ? expired : due;
  const names = relevant
    .slice(0, 3)
    .map((batch) => state.products.find((product) => product.id === batch.productId)?.name ?? batch.lotNumber)
    .join(', ');
  const label = expired.length ? copy.expiredBatches : copy.expiringSoon;

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title: 'Aardvarkland WMS-Mini',
          body: `${label}: ${names}${relevant.length > 3 ? ` (+${relevant.length - 3})` : ''}`,
          schedule: { at: new Date(Date.now() + 1000) },
          extra: { screen: 'reports', language, type: expired.length ? 'expired' : 'expiring' },
        },
      ],
    });
    safeStorageSet(fingerprintKey, fingerprint);
  } catch {
    // Notifications are optional. A plugin/OS failure must never turn an
    // otherwise valid warehouse state update into an unhandled rejection.
  }
}

function safeStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be blocked or full. Notification preferences are best-effort
    // and must not crash the Data screen or stock persistence workflow.
  }
}
