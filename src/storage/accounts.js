import { ACCT_KEY, IDB_STORE } from '../core/constants.js';
import { openProfilesDB } from './databases.js';
import { encryptPassword } from './credentials.js';
export { decryptPassword, encryptPassword, getCryptoKey } from './credentials.js';
export const ACCOUNTS_UPDATED_EVENT = 'lce:accounts-updated';

export async function dbGet(accountName) {
    try { return (await (await openProfilesDB()).get(IDB_STORE, accountName)) ?? null; }
    catch { return null; }
}
export async function dbPut(profile) {
    try { await (await openProfilesDB()).put(IDB_STORE, profile); return true; }
    catch { return false; }
}
export async function dbDelete(accountName) {
    const key = String(accountName || '').toUpperCase();
    if (!key) return false;
    try { await (await openProfilesDB()).delete(IDB_STORE, key); return true; }
    catch { return false; }
}

export function loadAccounts() {
    try { const list = JSON.parse(localStorage.getItem(ACCT_KEY) || '[]'); return Array.isArray(list) ? list : []; }
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

