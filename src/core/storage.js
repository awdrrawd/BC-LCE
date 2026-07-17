// ════════════════════════════════════════════════════════════════════════════
// 儲存層：AES-GCM 加密 + IndexedDB 角色快照 + localStorage 帳號清單
// 全部沿用 MPL 的 key 與資料格式，帳號 / 頭像 / 金鑰雙向共用。
// captureAndSaveProfile 完成後以事件通知 UI 重刷（避免與 UI 模組互相 import）。
// ════════════════════════════════════════════════════════════════════════════

import {
    ACCT_KEY, IDB_NAME, IDB_STORE, IDB_KEY_STORE,
    ASSET_IDB_NAME, ASSET_IDB_STORE, WALLPAPER_KEY, WALLPAPER_MAX_BYTES,
} from './constants.js';

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

// ── 自訂桌布（LCE 專屬的 IndexedDB）─────────────────────────────────────────
//
// 為什麼另開一個庫而不是塞進上面的 mpl-profiles：那個庫跟 MPL 共用、版本停在 2，
// 加 ObjectStore 得升到 3，而 MPL 仍用 open(mpl-profiles, 2) —— 開一個版本低於
// 現況的庫會直接丟 VersionError，等於把 MPL 的帳號與頭像全部弄壞。詳見 constants.js。

let _assetDb = null;
function openAssetDB() {
    return new Promise((resolve, reject) => {
        if (_assetDb) return resolve(_assetDb);
        const req = indexedDB.open(ASSET_IDB_NAME, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(ASSET_IDB_STORE)) db.createObjectStore(ASSET_IDB_STORE);
        };
        req.onsuccess = e => { _assetDb = e.target.result; resolve(_assetDb); };
        req.onerror   = () => reject(req.error);
    });
}

/**
 * 存一張自訂桌布（只留最新一張）。
 * 存 Blob 而非 data URL：同一張圖轉成 base64 會膨脹約 33%，而且每次要用都得重新解碼。
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function saveWallpaper(blob) {
    if (!(blob instanceof Blob)) return false;
    if (!blob.type.startsWith('image/')) throw new Error('not-an-image');
    if (blob.size > WALLPAPER_MAX_BYTES) throw new Error('too-large');
    const db = await openAssetDB();
    return new Promise(resolve => {
        const req = db.transaction(ASSET_IDB_STORE, 'readwrite').objectStore(ASSET_IDB_STORE)
            .put(blob, WALLPAPER_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror   = () => resolve(false);
    });
}

/** @returns {Promise<Blob|null>} 已上傳的自訂桌布。 */
export async function loadWallpaper() {
    try {
        const db = await openAssetDB();
        return await new Promise(resolve => {
            const req = db.transaction(ASSET_IDB_STORE).objectStore(ASSET_IDB_STORE).get(WALLPAPER_KEY);
            req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
            req.onerror   = () => resolve(null);
        });
    } catch { return null; }
}

/** 刪掉已上傳的自訂桌布。 */
export async function deleteWallpaper() {
    try {
        const db = await openAssetDB();
        return await new Promise(resolve => {
            const req = db.transaction(ASSET_IDB_STORE, 'readwrite').objectStore(ASSET_IDB_STORE)
                .delete(WALLPAPER_KEY);
            req.onsuccess = () => resolve(true);
            req.onerror   = () => resolve(false);
        });
    } catch { return false; }
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

/**
 * 一張拍成功的頭像至少該有這麼多位元組。
 *
 * 判斷「拍到空白」不能只看 canvas 存不存在：角色外觀還沒載完時 Player.Canvas
 * 是有尺寸的，只是內容一片空，畫出來就是一格純底色 —— toDataURL 仍會回傳一個
 * 看起來很正常的字串。而 JPEG 對純色的壓縮率極高，這種空白圖大概只有 6~700 位元組，
 * 真的有角色的頭像則遠大於此，所以用大小當「有沒有東西」的判準最省事也夠準。
 */
const MIN_AVATAR_BYTES = 900;

/** data URL 的實際位元組數（base64 每 4 字元 = 3 位元組）。 */
function dataUrlBytes(url) {
    const i = url.indexOf(',');
    if (i < 0) return 0;
    return Math.floor((url.length - i - 1) * 3 / 4);
}

/** @returns {string|null} 頭像 data URL；拍不到或拍到空白時回傳 null。 */
export function makeAvatarDataUrl(size = 56) {
    try {
        const src = Player?.Canvas;
        if (!src?.width || !src?.height) return null;
        const off = document.createElement('canvas');
        off.width = size; off.height = size;
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#0a0c12';
        ctx.fillRect(0, 0, size, size);
        const sx = src.width * 0.39, sy = src.height * 0.40;
        const sw = src.width * 0.22, sh = src.height * 0.12;
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, size, size);
        const url = off.toDataURL('image/jpeg', 0.85);
        return dataUrlBytes(url) >= MIN_AVATAR_BYTES ? url : null;
    } catch { return null; }
}

/**
 * 存一次角色快照。
 * @returns {Promise<boolean>} 這次有沒有拍到新頭像（沒拍到不代表沒存 —— 名稱等欄位照樣更新）
 */
export async function captureAndSaveProfile() {
    try {
        if (typeof Player === 'undefined' || !Player?.AccountName) return false;
        const accountName = Player.AccountName.toUpperCase();
        const avatarDataUrl = makeAvatarDataUrl(56);

        // 拍不到就沿用上一張，絕不能把 null 寫回去：那會把先前拍好的頭像洗掉，
        // 卡片永遠只剩貓咪佔位圖 —— 而且越是「退出太快」這種拍不到的時機，
        // 越不該把既有的好資料砸掉。
        const prev = avatarDataUrl ? null : await dbGet(accountName);

        await dbPut({
            accountName,
            name:          Player.Name        || '',
            nickname:      Player.Nickname    || null,
            memberNumber:  Player.MemberNumber ?? null,
            avatarDataUrl: avatarDataUrl ?? prev?.avatarDataUrl ?? null,
            savedAt:       Date.now(),
        });
        window.dispatchEvent(new CustomEvent(ACCOUNTS_UPDATED_EVENT));
        return !!avatarDataUrl;
    } catch (e) {
        console.warn('🐈‍⬛ [LCE] 快照失敗:', e);
        return false;
    }
}

/**
 * 排程頭像快照：拍到好的為止，最多試 tries 次。
 *
 * 原本是登入後單發一次（5 秒後拍一張就算數），太脆弱 —— 那一刻角色外觀可能還沒
 * 載完、或人正好在別的畫面，拍到空白就這樣定案了。改成隔一段時間重試，成功即收工；
 * 每一輪都會順手更新名稱/暱稱/ID，所以就算頭像一直拍不到，文字資訊仍是最新的。
 */
export function scheduleProfileCapture({ tries = 6, intervalMs = 5000 } = {}) {
    let attempt = 0;
    (function tryOnce() {
        attempt++;
        captureAndSaveProfile().then(gotAvatar => {
            if (gotAvatar || attempt >= tries) return;
            setTimeout(tryOnce, intervalMs);
        });
    })();
}
