import { openAssetsDB } from './databases.js';
import { ASSET_IDB_STORE, WALLPAPER_KEY, WALLPAPER_MAX_BYTES } from '../core/constants.js';

export async function saveWallpaper(blob) {
    if (!(blob instanceof Blob)) return false;
    if (!blob.type.startsWith('image/')) throw new Error('not-an-image');
    if (blob.size > WALLPAPER_MAX_BYTES) throw new Error('too-large');
    const db = await openAssetsDB();
    try { await db.put(ASSET_IDB_STORE, blob, WALLPAPER_KEY); return true; }
    catch { return false; }
}

export async function loadWallpaper() {
    try {
        const blob = await (await openAssetsDB()).get(ASSET_IDB_STORE, WALLPAPER_KEY);
        return blob instanceof Blob ? blob : null;
    } catch { return null; }
}

export async function deleteWallpaper() {
    try { await (await openAssetsDB()).delete(ASSET_IDB_STORE, WALLPAPER_KEY); return true; }
    catch { return false; }
}
