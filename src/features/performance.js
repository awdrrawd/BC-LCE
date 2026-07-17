// ════════════════════════════════════════════════════════════════════════════
// 性能
//   automateCacheClear   每小時清除繪圖緩存（移植 WCE cacheClearer.ts）
//   manualCacheClear     在聊天室選單加一顆清除/重載繪圖緩存的按鈕（同上）
//   scrollMaxMessages    限制聊天室可見訊息數量與上限（移植 BC_LianOptimizationSource）
//                        開關是 scrollMaxMessagesEnabled（withToggle 產生的鍵）
//   reduceTextureQuality 降低角色貼圖畫質
//   lowFrameRate         低幀率模式
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const CACHE_CLEAR_INTERVAL = 60 * 60 * 1000;   // 1 小時
const CHATLOG = 'TextAreaChatLog';
const HIDDEN_ATTR = 'data-lce-auto-hidden';

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, '性能 hook 未掛上:', name, e?.message ?? e); }
}

// ───────────────────────── 繪圖緩存（WCE cacheClearer）─────────────────────────
export function doClearCaches() {
    try {
        if (typeof GLDrawCanvas !== 'undefined' && GLDrawCanvas) {
            GLDrawCanvas.GL?.textureCache?.clear();
            if (typeof GLDrawResetCanvas === 'function') GLDrawResetCanvas();
        }
        // 清掉已不在房間內的舊角色，其餘重新整理
        const stale = Character.filter(c => c.IsOnline?.() && !ChatRoomCharacter.some(cc => cc.MemberNumber === c.MemberNumber));
        stale.forEach(c => CharacterDelete(c));
        Character.filter(c => c.IsOnline?.()).forEach(c => CharacterRefresh(c, false, false));
        console.debug(LOG, '已清除繪圖緩存');
    } catch (e) { console.warn(LOG, '清除繪圖緩存失敗:', e); }
}

/** 只在「聊天室、沒在檢視角色、視窗有焦點」時才清，避免打斷操作（同 WCE）。 */
function clearWhenSafe() {
    const start = Date.now();
    (function wait() {
        if (!getFeature('automateCacheClear')) return;
        if (Date.now() - start > CACHE_CLEAR_INTERVAL) return;   // 等太久就放棄，下輪再說
        const ok = typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom'
            && !CurrentCharacter && document.hasFocus();
        if (ok) { doClearCaches(); return; }
        setTimeout(wait, 5000);
    })();
}

// ───────────────────────── 聊天記錄條數（Lian）─────────────────────────
const shouldSkip = (msg) => !!msg?.classList?.contains('chat-room-sep');   // 房間分隔線不隱藏

function updateChatVisibility() {
    const log = document.getElementById(CHATLOG);
    if (!log) return;
    const messages = Array.from(log.children);

    if (!getFeature('scrollMaxMessagesEnabled')) {
        // 關閉時把先前隱藏的還原（只還原我們自己隱藏的）
        for (const m of messages) {
            if (m.getAttribute(HIDDEN_ATTR)) { m.style.display = ''; m.removeAttribute(HIDDEN_ATTR); }
        }
        return;
    }

    const max = parseInt(getFeature('scrollMaxMessages'), 10) || 50;
    const hideCount = messages.length - max;
    messages.forEach((m, i) => {
        if (i < hideCount) {
            if (m.style.display !== 'none' && !shouldSkip(m)) { m.style.display = 'none'; m.setAttribute(HIDDEN_ATTR, 'true'); }
        } else if (m.getAttribute(HIDDEN_ATTR)) {
            m.style.display = ''; m.removeAttribute(HIDDEN_ATTR);
        }
    });
}

// ───────────────────────── 低幀率（Lian）─────────────────────────
let origRAF = null;
let lastFrame = 0;

function applyFrameRateLimit() {
    const on = !!getFeature('lowFrameRate');
    if (on && !origRAF) {
        origRAF = window.requestAnimationFrame.bind(window);
        // 以固定間隔節流：畫面較不流暢，但省效能
        window.requestAnimationFrame = (cb) => origRAF((t) => {
            const interval = 1000 / 30;   // 低幀率模式 = 30fps
            if (t - lastFrame >= interval) { lastFrame = t; cb(t); }
            else window.requestAnimationFrame(cb);
        });
    } else if (!on && origRAF) {
        window.requestAnimationFrame = origRAF;
        origRAF = null;
    }
}

let installed = false;

export function installPerformance() {
    if (installed) return;
    installed = true;

    // 聊天室選單的清除緩存按鈕
    hook('ChatRoomMenuBuild', 10, (args, next) => {
        const ret = next(args);
        try {
            if (getFeature('manualCacheClear') && typeof ChatRoomMenuButtons !== 'undefined'
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
        return doClearCaches();
    });

    // 每小時自動清
    setInterval(() => { if (getFeature('automateCacheClear')) clearWhenSafe(); }, CACHE_CLEAR_INTERVAL);

    // 降低角色貼圖畫質：交給 BC 自己的繪圖設定，避免自行改寫 WebGL 上傳流程
    hook('GLDrawBingImageToTextureInfo', 10, (args, next) => {
        if (!getFeature('reduceTextureQuality')) return next(args);
        const [gl, , textureInfo] = args;
        try {
            // 用 LINEAR + 不產生 mipmap：省記憶體與上傳時間，畫質略降
            const ret = next(args);
            if (gl && textureInfo?.texture) {
                gl.bindTexture(gl.TEXTURE_2D, textureInfo.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            }
            return ret;
        } catch { return next(args); }
    });

    // 聊天記錄條數：新訊息與捲動時更新
    hook('ChatRoomAppendChat', 0, (args, next) => {
        const ret = next(args);
        try { updateChatVisibility(); } catch { /* ignore */ }
        return ret;
    });
    setInterval(() => { try { updateChatVisibility(); } catch { /* ignore */ } }, 2000);

    // 低幀率：每次設定變更時套用/還原
    setInterval(() => { try { applyFrameRateLimit(); } catch { /* ignore */ } }, 1000);
}
