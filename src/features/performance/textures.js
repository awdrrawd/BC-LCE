import { createHook } from '../../core/hooks.js';
import { getFeature } from '../../core/feature-settings.js';
import { shouldLceHandle } from '../../core/wce-compat.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';
const LOG = '🐈‍⬛ [LCE]';
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
        if (typeof GLDrawCanvas !== 'undefined' && GLDrawCanvas) {
            GLDrawCanvas.GL?.textureCache?.clear();
            if (typeof GLDrawResetCanvas === 'function') GLDrawResetCanvas();
        }
        Character?.filter(c => c.IsOnline?.()).forEach(c => CharacterRefresh(c, false, false));
    } catch (e) { console.warn(LOG, '重載貼圖失敗:', e); }
}

export function doClearCaches() {
    try {
        // 清掉已不在房間內的舊角色（只有在聊天室裡才有意義，見 reloadTextures 的說明）
        const stale = Character.filter(c => c.IsOnline?.() && !ChatRoomCharacter.some(cc => cc.MemberNumber === c.MemberNumber));
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
 * 把圖畫進較小的離屏 canvas。回傳 null 代表這張圖不縮（交回原圖）。
 * 註：BC 的貼圖全是同源（或已帶 CORS）—— 否則它自己的 texImage2D(Img) 也會
 * 丟 SecurityError，所以這裡的 canvas 不會被污染。
 */
function downscaleImage(img, scale) {
    if (!img?.width || !img?.height) return null;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return cv;
}

/**
 * 貼圖是「載入時上傳一次就進 gl.textureCache，之後不再經過我們的 hook」
 * （見 BC GLDraw.js 的 GLDrawLoadImage：cache 有就直接回傳）。
 * 所以改了畫質一定要把貼圖丟掉重載，否則已經在畫面上的角色不會有任何變化，
 * 設定看起來就像壞掉 —— 要等下一次每小時自動清緩存或重整頁面才生效。
 */
function onTextureSettingChanged(key) {
    if (key !== 'textureQuality' && key !== 'textureQualityEnabled') return;
    reloadTextures();
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
        return { image: 'Icons/Small/Reset.png', state: 'Default', hoverText: T('perf_clear_cache') };
    });

    hook('ChatRoomMenuPerformAction', 10, (args, next) => {
        if (args[0] !== 'lceClearCache') return next(args);
        if (!shouldLceHandle('manualCacheClear')) return;
        return doClearCaches();
    });

    // 每小時自動清
    setInterval(() => { if (shouldLceHandle('automateCacheClear')) clearWhenSafe(); }, CACHE_CLEAR_INTERVAL);

    // 降低角色貼圖解析度
    hook('GLDrawBingImageToTextureInfo', 10, (args, next) => {
        if (!getFeature('textureQualityEnabled')) return next(args);
        const scale = TEXTURE_SCALE[getFeature('textureQuality')];
        if (!scale) return next(args);

        const [gl, img, textureInfo] = args;
        let small = null;
        try { small = downscaleImage(img, scale); }
        catch (e) { console.warn(LOG, '貼圖縮放失敗，改用原圖:', e); }
        if (!small) return next(args);

        const ret = next([gl, small, textureInfo]);
        // next() 會依傳進去的圖設定 textureInfo.width/height，但那組數字是
        // GLDrawImage 用來算「畫多大」的（見 BC GLDraw.js 的 m4.scale），
        // 不是貼圖解析度。不改回原圖尺寸，角色會整個照 scale 縮小。
        textureInfo.width = img.width;
        textureInfo.height = img.height;
        return ret;
    });

    window.addEventListener(SETTING_CHANGED_EVENT, e => {
        try { onTextureSettingChanged(e.detail?.key); } catch { /* ignore */ }
    });
}
