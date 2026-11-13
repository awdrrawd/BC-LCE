import { createHook } from '../../core/hooks.js';
import { getFeature } from '../../core/feature-settings.js';
import { shouldLceHandle } from '../../core/wce-compat.js';
import { SETTING_CHANGED_EVENT, LOG } from '../../core/constants.js';
const hook = createHook('performance');
import { T } from '../../core/i18n.js';
const CACHE_CLEAR_INTERVAL = 60 * 60 * 1000;
// ───────────────────────── 繪圖緩存（WCE cacheClearer）─────────────────────────

/**
 * 丟掉所有貼圖並讓角色重畫，不動 Character 清單。
 *
 * 刻意跟 doClearCaches 分開：那邊會把「不在房間裡」的線上角色整個刪掉，
 * 只有在聊天室裡（ChatRoomCharacter 有內容）才是對的。在偏好設定頁呼叫的話，
 * ChatRoomCharacter 是空的 → 連玩家自己都會被判定成 stale 而刪除
 * （BC 的 CharacterDelete 沒有擋玩家）。
 */
function reloadTextures() {
    try {
        // 新版 BC：貼圖放在 GLDrawImageCache（ImageCache），GLDrawResetCanvas 會
        // 把舊貼圖全部 unload、重建 canvas 與新的快取，並重畫畫面上的角色。
        // （舊版的 GL.textureCache 已不存在。）
        if (typeof GLDrawCanvas !== 'undefined' && GLDrawCanvas && typeof GLDrawResetCanvas === 'function') {
            GLDrawResetCanvas();
        }
        Character?.filter(c => c.IsOnline?.()).forEach(c => CharacterRefresh(c, false, false));
    } catch (e) { console.warn(LOG, '重載貼圖失敗:', e); }
}

export function doClearCaches() {
    try {
        // 清掉已不在房間內的舊角色（只有在聊天室裡才有意義，見 reloadTextures 的說明）
        const present = new Set(ChatRoomCharacter.map(c => c.MemberNumber));
        const stale = Character.filter(c => c.IsOnline?.() && !present.has(c.MemberNumber));
        stale.forEach(c => CharacterDelete(c));
        reloadTextures();
        console.debug(LOG, '已清除繪圖緩存');
    } catch (e) { console.warn(LOG, '清除繪圖緩存失敗:', e); }
}

/** 只在「聊天室、沒在檢視角色、視窗有焦點」時才清，避免打斷操作（同 WCE）。 */
function clearWhenSafe() {
    const start = Date.now();
    (function wait() {
        if (!shouldLceHandle('automateCacheClear')) return;
        if (Date.now() - start > CACHE_CLEAR_INTERVAL) return;   // 等太久就放棄，下輪再說
        const ok = typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom'
            && !CurrentCharacter && document.hasFocus();
        if (ok) { doClearCaches(); return; }
        setTimeout(wait, 5000);
    })();
}
// ───────────────────────── 貼圖解析度 ─────────────────────────

/** 各檔位對應的貼圖縮放比例。 */
const TEXTURE_SCALE = { normal: 0.7, low: 0.5, lowest: 0.3 };

/**
 * 貼圖是「載入時解碼上傳一次就進 GLDrawImageCache，之後不再經過解碼器」
 * （見 BC GLDraw.js 的 GLDrawLoadImage：cache 有就直接回傳）。
 * 所以改了畫質一定要把貼圖丟掉重載，否則已經在畫面上的角色不會有任何變化，
 * 設定看起來就像壞掉 —— 要等下一次每小時自動清緩存或重整頁面才生效。
 */
function onTextureSettingChanged(key) {
    if (key !== 'textureQuality' && key !== 'textureQualityEnabled') return;
    reloadTextures();
}

/**
 * 解碼並縮小貼圖。回傳的 width/height 維持「原圖尺寸」：
 * GLDrawImage 用它們算繪製大小（m4.scale），不是貼圖解析度，
 * 改成縮小後的尺寸角色會整個縮小。GL 取樣用正規化座標，所以貼圖本身可以較小。
 */
async function decodeScaled(blob, scale, original) {
    const gl = typeof GLDrawCanvas !== 'undefined' ? GLDrawCanvas?.GL : null;
    if (!gl || typeof GLDrawCreateTexture !== 'function' || typeof createImageBitmap !== 'function') {
        return original(blob);
    }
    let full = null, small = null;
    try {
        full = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
        const w = Math.max(1, Math.round(full.width * scale));
        const h = Math.max(1, Math.round(full.height * scale));
        small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none' });
        const texture = GLDrawCreateTexture(gl);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
            return { width: full.width, height: full.height, texture };
        } catch (e) {
            gl.deleteTexture(texture);
            throw e;
        }
    } catch (e) {
        console.warn(LOG, '貼圖縮放失敗，改用原圖:', e);
        return original(blob);
    } finally {
        try { small?.close(); } catch { /* ignore */ }
        try { full?.close(); } catch { /* ignore */ }
    }
}

/** 把 LCE 的縮圖解碼器掛到目前的 GLDrawImageCache 上（每個快取實例只包一次）。 */
function wrapTextureDecoder() {
    try {
        const cache = typeof GLDrawImageCache !== 'undefined' ? GLDrawImageCache : null;
        if (!cache || cache._lceDecodeWrapped || typeof cache._decode !== 'function') return;
        const original = cache._decode.bind(cache);
        cache._decode = (blob) => {
            if (!getFeature('textureQualityEnabled')) return original(blob);
            const scale = TEXTURE_SCALE[getFeature('textureQuality')];
            if (!scale) return original(blob);
            return decodeScaled(blob, scale, original);
        };
        cache._lceDecodeWrapped = true;
    } catch (e) { console.warn(LOG, '貼圖解碼器包裝失敗（BC 版本可能有變動）:', e); }
}

let installed = false;
export function installTexturePerformance() {
    if (installed) return;
    installed = true;
    // 聊天室選單的清除緩存按鈕
    hook('ChatRoomMenuBuild', 10, (args, next) => {
        const ret = next(args);
        try {
            if (!shouldLceHandle('manualCacheClear') && typeof ChatRoomMenuButtons !== 'undefined') {
                for (let i = ChatRoomMenuButtons.length - 1; i >= 0; i--) {
                    if (ChatRoomMenuButtons[i] === 'lceClearCache') ChatRoomMenuButtons.splice(i, 1);
                }
            }
            if (shouldLceHandle('manualCacheClear') && typeof ChatRoomMenuButtons !== 'undefined'
                && !ChatRoomMenuButtons.includes('lceClearCache')) {
                const at = ChatRoomMenuButtons.indexOf('Cut');
                ChatRoomMenuButtons.splice(at < 0 ? 0 : at, 0, 'lceClearCache');
            }
        } catch (e) { console.warn(LOG, e); }
        return ret;
    });

    hook('ChatRoomMenuButtonVisualState', 10, (args, next) => {
        if (args[0] !== 'lceClearCache') return next(args);
        return { image: 'Icons/Reset.png', state: 'Default', hoverText: T('perf_clear_cache') };
    });

    hook('ChatRoomMenuPerformAction', 10, (args, next) => {
        if (args[0] !== 'lceClearCache') return next(args);
        if (!shouldLceHandle('manualCacheClear')) return;
        return doClearCaches();
    });

    // 每小時自動清
    setInterval(() => { if (shouldLceHandle('automateCacheClear')) clearWhenSafe(); }, CACHE_CLEAR_INTERVAL);

    // 降低角色貼圖解析度
    // BC 的 ImageCache 在建構時就把 GLDrawDecodeImage 存進 cache._decode，
    // 所以 hook 全域函式不會生效，必須包裝快取實例本身。
    // GLDrawResetCanvas → GLDrawLoad 會建立新的快取，因此每次載入後要重包一次。
    wrapTextureDecoder();
    hook('GLDrawLoad', 10, (args, next) => {
        const ret = next(args);
        wrapTextureDecoder();
        return ret;
    });

    window.addEventListener(SETTING_CHANGED_EVENT, e => {
        try { onTextureSettingChanged(e.detail?.key); } catch { /* ignore */ }
    });
}
