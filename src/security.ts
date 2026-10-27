const key = 'aardvarkland-mini-lock-v1';
const attemptsKey = 'aardvarkland-mini-lock-attempts-v1';
const saltPattern = /^[0-9a-f]{32}$/i;
const hashPattern = /^[0-9a-f]{64}$/i;
const ITERATIONS = 600_000;
export type LockConfig = { salt: string; hash: string; version?: number; invalid?: boolean };
const invalidLock: LockConfig = { salt: '', hash: '', invalid: true };
let failures = 0; let blockedUntil = 0; let verifying = false;

export function readLock(): LockConfig | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidLock;
    if (typeof value.salt !== 'string' || typeof value.hash !== 'string'
      || !saltPattern.test(value.salt) || !hashPattern.test(value.hash)
      || (value.version !== undefined && value.version !== 2)) return invalidLock;
    return { salt: value.salt.toLowerCase(), hash: value.hash.toLowerCase(), ...(value.version === 2 ? { version: 2 } : {}) };
  } catch { return invalidLock; }
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('INVALID_PIN');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(key, JSON.stringify({ version: 2, salt: hex(salt), hash: await hashPin(pin, salt, ITERATIONS) }));
  resetAttempts();
}

export async function verifyPin(pin: string): Promise<boolean> {
  const config = readLock();
  if (!config) return true;
  if (config.invalid || verifying) return false;
  readAttempts();
  if (Date.now() < blockedUntil) return false;
  verifying = true;
  try {
    const matches = /^\d{4,8}$/.test(pin) && constantTimeEqual(await hashPin(pin, fromHex(config.salt), config.version === 2 ? ITERATIONS : 150_000), config.hash);
    if (matches) { resetAttempts(); return true; }
    failures = Math.min(failures + 1, 32);
    blockedUntil = Date.now() + (failures < 5 ? 0 : Math.min(60_000, 1000 * 2 ** (failures - 5)));
    try { localStorage.setItem(attemptsKey, JSON.stringify({ failures, blockedUntil })); } catch { /* Keep session cooldown. */ }
    return false;
  } catch { return false; }
  finally { verifying = false; }
}

export function disablePin(): void { localStorage.removeItem(key); resetAttempts(); }
function readAttempts() {
  try {
    const value = JSON.parse(localStorage.getItem(attemptsKey) || 'null');
    if (value && Number.isSafeInteger(value.failures) && value.failures >= 0 && Number.isFinite(value.blockedUntil)) {
      failures = Math.max(failures, Math.min(32, value.failures));
      blockedUntil = Math.max(blockedUntil, Math.min(Date.now() + 60_000, value.blockedUntil));
    }
  } catch { /* Invalid cooldown must not reset the in-memory attempt counter. */ }
}
function resetAttempts() { failures = 0; blockedUntil = 0; try { localStorage.removeItem(attemptsKey); } catch { /* Session state has been reset. */ } }
function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let i=0;i<64;i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
async function hashPin(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material, 256);
  return hex(new Uint8Array(bits));
}
function hex(value: Uint8Array): string { return [...value].map(item => item.toString(16).padStart(2,'0')).join(''); }
function fromHex(value: string): Uint8Array {
  if (!saltPattern.test(value)) throw new Error('INVALID_LOCK_SALT');
  return new Uint8Array(value.match(/.{2}/g)!.map(item => Number.parseInt(item,16)));
}
