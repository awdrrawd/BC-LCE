// ════════════════════════════════════════════════════════════════════════════
// 儲存層：AES-GCM 加密 + IndexedDB 角色快照 + localStorage 帳號清單
// 全部沿用 MPL 的 key 與資料格式，帳號 / 頭像 / 金鑰雙向共用。
// captureAndSaveProfile 完成後以事件通知 UI 重刷（避免與 UI 模組互相 import）。
// ════════════════════════════════════════════════════════════════════════════

import { ACCT_KEY, IDB_NAME, IDB_STORE, IDB_KEY_STORE } from './constants.js';

/** 帳號快照更新事件名稱（account-carousel 監聽） */
export const ACCOUNTS_UPDATED_EVENT = 'lce:accounts-updated';

// ── AES-GCM ─────────────────────────────────────────────────────────────────

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
        const db = await openDB();
        const existing = await new Promise(resolve => {
            const req = db.transaction(IDB_KEY_STORE).objectStore(IDB_KEY_STORE).get('mainKey');
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror   = () => resolve(null);
        });
        if (existing?.key)
            return crypto.subtle.importKey('jwk', existing.key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const key      = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const exported = await crypto.subtle.exportKey('jwk', key);
        await new Promise(resolve => {
            const req = db.transaction(IDB_KEY_STORE, 'readwrite').objectStore(IDB_KEY_STORE)
                .put({ id: 'mainKey', key: exported });
            req.onsuccess = () => resolve(true);
            req.onerror   = () => resolve(false);
        });
        return key;
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

// ── IndexedDB（角色快照 + 金鑰）─────────────────────────────────────────────

let _db = null;
function openDB() {
    return new Promise((resolve, reject) => {
        if (_db) return resolve(_db);
        const req = indexedDB.open(IDB_NAME, 2);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE))     db.createObjectStore(IDB_STORE, { keyPath: 'accountName' });
            if (!db.objectStoreNames.contains(IDB_KEY_STORE)) db.createObjectStore(IDB_KEY_STORE, { keyPath: 'id' });
        };
        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror   = () => reject(req.error);
    });
}

export async function dbGet(accountName) {
    const db = await openDB();
    return new Promise(resolve => {
        const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(accountName);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => resolve(null);
    });
}
export async function dbPut(profile) {
    const db = await openDB();
    return new Promise(resolve => {
        const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(profile);
        req.onsuccess = () => resolve(true);
        req.onerror   = () => resolve(false);
    });
}
export async function dbDelete(accountName) {
    const key = String(accountName || '').toUpperCase();
    if (!key) return false;
    const db = await openDB();
    return new Promise(resolve => {
        const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror   = () => resolve(false);
    });
}

// ── localStorage 帳號清單 ───────────────────────────────────────────────────

/** @returns {Array<{accountName:string,password:string,addedAt:number}>} */
export function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCT_KEY) || '[]'); }
    catch { return []; }
}
export function saveAccounts(list) { localStorage.setItem(ACCT_KEY, JSON.stringify(list)); }

export async function addOrUpdateAccount(accountName, plainPassword) {
    const key       = accountName.toUpperCase();
    const encrypted = await encryptPassword(plainPassword);
    const list      = loadAccounts();
    const idx       = list.findIndex(a => a.accountName === key);
    if (idx >= 0) list[idx].password = encrypted;
    else list.push({ accountName: key, password: encrypted, addedAt: Date.now() });
    saveAccounts(list);
    return key;
}
export function removeAccount(accountName) {
    const key = String(accountName || '').toUpperCase();
    if (!key) return;
    saveAccounts(loadAccounts().filter(a => a.accountName !== key));
}

// ── 角色快照（頭像 + 暱稱 + ID）—— 與 MPL 相同格式 ─────────────────────────

export function makeAvatarDataUrl(size = 56) {
    try {
        const src = Player?.Canvas;
        if (!src || src.width === 0) return null;
        const off = document.createElement('canvas');
        off.width = size; off.height = size;
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#0a0c12';
        ctx.fillRect(0, 0, size, size);
        const sx = src.width * 0.39, sy = src.height * 0.40;
        const sw = src.width * 0.22, sh = src.height * 0.12;
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, size, size);
        return off.toDataURL('image/jpeg', 0.85);
    } catch { return null; }
}

export async function captureAndSaveProfile() {
    try {
        if (typeof Player === 'undefined' || !Player?.AccountName) return;
        await dbPut({
            accountName:   Player.AccountName.toUpperCase(),
            name:          Player.Name        || '',
            nickname:      Player.Nickname    || null,
            memberNumber:  Player.MemberNumber ?? null,
            avatarDataUrl: makeAvatarDataUrl(56),
            savedAt:       Date.now(),
        });
        window.dispatchEvent(new CustomEvent(ACCOUNTS_UPDATED_EVENT));
    } catch (e) {
        console.warn('🐈‍⬛ [LCE] 快照失敗:', e);
    }
}
