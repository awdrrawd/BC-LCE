import { openDB } from 'idb';
import { IDB_NAME, IDB_STORE, IDB_KEY_STORE, ASSET_IDB_NAME, ASSET_IDB_STORE } from '../core/constants.js';

function connection(name, version, upgrade) {
    let pending;
    return () => pending ??= openDB(name, version, {
        upgrade,
        blocking() { pending?.then(db => db.close()).catch(() => {}); pending = null; },
        terminated() { pending = null; },
    }).catch(error => { pending = null; throw error; });
}

// MPL shares this schema and opens version 2. Do not increase the version or merge databases.
export const openProfilesDB = connection(IDB_NAME, 2, db => {
    if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'accountName' });
    if (!db.objectStoreNames.contains(IDB_KEY_STORE)) db.createObjectStore(IDB_KEY_STORE, { keyPath: 'id' });
});

export const openAssetsDB = connection(ASSET_IDB_NAME, 1, db => {
    if (!db.objectStoreNames.contains(ASSET_IDB_STORE)) db.createObjectStore(ASSET_IDB_STORE);
});
