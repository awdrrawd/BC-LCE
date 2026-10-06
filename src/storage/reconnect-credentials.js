import { loadAccounts, decryptPassword } from './accounts.js';

// Session-only cache used by automatic reconnect. Passwords never leave memory here;
// the persisted account store remains encrypted as before.
const cache = new Map();
const pending = new Map();

function keyOf(accountName) {
    const key = String(accountName ?? '').trim().toUpperCase();
    return key || null;
}

/** Cache a plaintext password for the current browser session only. */
export function cacheReconnectPassword(accountName, password) {
    const key = keyOf(accountName);
    if (!key || typeof password !== 'string' || !password) return false;
    cache.set(key, password);
    return true;
}

/** Return a session-cached plaintext password, or null when it is not ready. */
export function getReconnectPassword(accountName) {
    const key = keyOf(accountName);
    return key ? cache.get(key) ?? null : null;
}

/**
 * Warm the reconnect password in the background before it is needed.
 * Concurrent callers share one decryption promise.
 */
export function warmReconnectPassword(accountName) {
    const key = keyOf(accountName);
    if (!key) return Promise.resolve(null);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (pending.has(key)) return pending.get(key);

    const work = Promise.resolve().then(async () => {
        try {
            const account = loadAccounts().find(a => keyOf(a?.accountName) === key);
            if (!account) return null;
            const plain = await decryptPassword(account.password);
            if (!plain) return null;
            cache.set(key, plain);
            return plain;
        } catch {
            return null;
        } finally {
            pending.delete(key);
        }
    });
    pending.set(key, work);
    return work;
}

