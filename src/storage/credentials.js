import { openProfilesDB } from './databases.js';
import { IDB_KEY_STORE } from '../core/constants.js';

const bufToB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64ToBuf = b64 => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
};

let _cryptoKeyPromise = null;
export function getCryptoKey() {
    if (_cryptoKeyPromise) return _cryptoKeyPromise;
    _cryptoKeyPromise = (async () => {
        const db = await openProfilesDB();
        const existing = await db.get(IDB_KEY_STORE, 'mainKey');
        if (existing?.key) return crypto.subtle.importKey('jwk', existing.key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const exported = await crypto.subtle.exportKey('jwk', candidate);
        // Recheck under a write transaction so simultaneous tabs adopt the same key.
        const tx = db.transaction(IDB_KEY_STORE, 'readwrite');
        try {
            const winner = await tx.store.get('mainKey');
            if (!winner?.key) await tx.store.put({ id: 'mainKey', key: exported });
            await tx.done;
            return winner?.key
                ? crypto.subtle.importKey('jwk', winner.key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
                : candidate;
        } catch (error) {
            await tx.done.catch(() => {});
            throw error;
        }
    })().catch(e => { _cryptoKeyPromise = null; return Promise.reject(e); });
    return _cryptoKeyPromise;
}

export async function encryptPassword(plaintext) {
    const key    = await getCryptoKey();
    const iv     = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return bufToB64(iv.buffer) + ':' + bufToB64(cipher);
}

export async function decryptPassword(stored) {
    try {
        const key = await getCryptoKey();
        const [ivB64, cipherB64] = stored.split(':');
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) }, key, b64ToBuf(cipherB64));
        return new TextDecoder().decode(plain);
    } catch (e) {
        console.warn('🐈‍⬛ [LCE] 解密失敗:', e);
        return null;
    }
}

