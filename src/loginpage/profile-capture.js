import { dbGet, dbPut, ACCOUNTS_UPDATED_EVENT } from '../storage/accounts.js';

// ── 角色快照（頭像 + 暱稱 + ID）────────────────────────────────────────────

/**
 * 一張拍成功的頭像至少該有這麼多位元組。
 *
 * 判斷「拍到空白」不能只看 canvas 存不存在：角色外觀還沒載完時 Player.Canvas
 * 是有尺寸的，只是內容一片空，畫出來就是一格純底色 —— toDataURL 仍會回傳一個
 * 看起來很正常的資料。而 WebP 對純色的壓縮率極高，空白圖會明顯小於真正的角色頭像，
 * 真的有角色的頭像則遠大於此，所以用大小當「有沒有東西」的判準最省事也夠準。
 */
const MIN_AVATAR_BYTES = 900;

/** @returns {Promise<Blob|null>} WebP 頭像；拍不到或拍到空白時回傳 null。 */
export async function makeAvatarBlob(size = 56) {
    try {
        const src = Player?.Canvas;
        if (!src?.width || !src?.height) return null;
        const off = document.createElement('canvas');
        off.width = size; off.height = size;
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#0a0c12';
        ctx.fillRect(0, 0, size, size);
        const cropSize = 210;
        const sx = src.width / 2 - cropSize / 2;
        ctx.drawImage(src, sx, 740, cropSize, cropSize, 0, 0, size, size);
        const blob = await new Promise(resolve => off.toBlob(resolve, 'image/webp', 0.9));
        return blob?.size >= MIN_AVATAR_BYTES ? blob : null;
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
        const avatarBlob = await makeAvatarBlob(56);

        // 拍不到就沿用上一張，絕不能把 null 寫回去：那會把先前拍好的頭像洗掉，
        // 卡片永遠只剩貓咪佔位圖 —— 而且越是「退出太快」這種拍不到的時機，
        // 越不該把既有的好資料砸掉。
        const prev = avatarBlob ? null : await dbGet(accountName);

        const saved = await dbPut({
            accountName,
            name:          Player.Name        || '',
            nickname:      Player.Nickname    || null,
            memberNumber:  Player.MemberNumber ?? null,
            avatarBlob:    avatarBlob ?? prev?.avatarBlob ?? null,
            // 舊版以 base64 data URL 儲存；保留讀取相容性，成功拍到 Blob 後即不再複製。
            avatarDataUrl: avatarBlob ? null : (prev?.avatarDataUrl ?? null),
            savedAt:       Date.now(),
        });
        if (!saved) return false;
        window.dispatchEvent(new CustomEvent(ACCOUNTS_UPDATED_EVENT));
        return !!avatarBlob;
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
