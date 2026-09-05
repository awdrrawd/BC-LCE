import { openDB } from 'idb';

export function createHistoryRepository(accountName) {
    let opening = null, restored = null, ready = false;
    const key = () => 'im-' + accountName();
    const open = () => opening ??= openDB('lce-im', 1, {
        upgrade(db) { if (!db.objectStoreNames.contains('history')) db.createObjectStore('history'); },
    }).catch(error => { opening = null; throw error; });
    return {
        open,
        restore(render) {
            return restored ??= (async () => {
                const db = await open();
                const history = await db.get('history', key());
                await render(history ?? {});
                ready = true;
            })().catch(error => { restored = null; throw error; });
        },
        async save(history) {
            if (!ready) return false;
            try { await (await open()).put('history', history, key()); return true; }
            catch (error) { console.warn('🐈‍⬛ [LCE] IM 歷史儲存失敗:', error); return false; }
        },
    };
}
