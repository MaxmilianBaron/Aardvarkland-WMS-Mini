const key = 'aardvarkland-mini-lock-v1';
const saltPattern = /^[0-9a-f]{32}$/i;
const hashPattern = /^[0-9a-f]{64}$/i;

export type LockConfig = { salt: string; hash: string };

export function readLock(): LockConfig | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const salt = (value as { salt?: unknown }).salt;
    const hash = (value as { hash?: unknown }).hash;
    if (typeof salt !== 'string' || typeof hash !== 'string') return null;
    if (!saltPattern.test(salt) || !hashPattern.test(hash)) return null;
    return { salt: salt.toLowerCase(), hash: hash.toLowerCase() };
  } catch {
    return null;
  }
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('INVALID_PIN');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(key, JSON.stringify({ salt: hex(salt), hash: await hashPin(pin, salt) }));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const config = readLock();
  if (!config) return true;
  try {
    return (await hashPin(pin, fromHex(config.salt))) === config.hash;
  } catch {
    return false;
  }
}

export function disablePin(): void {
  localStorage.removeItem(key);
}

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' }, material, 256);
  return hex(new Uint8Array(bits));
}

function hex(value: Uint8Array): string {
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  if (!saltPattern.test(value)) throw new Error('INVALID_LOCK_SALT');
  return new Uint8Array(value.match(/.{2}/g)?.map((item) => Number.parseInt(item, 16)) ?? []);
}
