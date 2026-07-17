// ════════════════════════════════════════════════════════════════════════════
// 性能
//   automateCacheClear   每小時清除繪圖緩存（移植 WCE cacheClearer.ts）
//   manualCacheClear     在聊天室選單加一顆清除/重載繪圖緩存的按鈕（同上）
//   scrollMaxMessages    聊天記錄可見數（超出的舊訊息延遲渲染，移植 Liko - CCM）
//   autoPruneMessages    自動清除：訊息多到吃記憶體時物理移除最舊的（同上）
//   textureQuality       降低角色貼圖解析度
//   lowFrameRateFps      低幀率模式（可調上限）
//   showFps              顯示 FPS（可選位置）
//
// 各項的開關都是 withToggle 產生的 `<key>Enabled` 鍵。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { DEFAULT_FEATURE_SETTINGS, clampBar } from '../core/settings-schema.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const CACHE_CLEAR_INTERVAL = 60 * 60 * 1000;   // 1 小時
const CHATLOG = 'TextAreaChatLog';

/** 讀取 bar 型設定並正規化（存檔可能是舊版留下的字串）。 */
const bar = (key) => clampBar(DEFAULT_FEATURE_SETTINGS[key], getFeature(key));

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, '性能 hook 未掛上:', name, e?.message ?? e); }
}

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
        if (!getFeature('automateCacheClear')) return;
        if (Date.now() - start > CACHE_CLEAR_INTERVAL) return;   // 等太久就放棄，下輪再說
        const ok = typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom'
            && !CurrentCharacter && document.hasFocus();
        if (ok) { doClearCaches(); return; }
        setTimeout(wait, 5000);
    })();
}

// ════════════════════════════════════════════════════════════════════════════
// 聊天記錄容量（移植 Liko - CCM 1.1.0）
//
// 舊版的作法是把超出上限的訊息 display:none。那只省下繪製，訊息節點與其佔的
// 記憶體都還在，而且被隱藏的訊息一樣參與排版計算 —— 長時間掛在高流量房間時
// 該卡還是卡。改成 CCM 的兩段式：
//
//   1. 延遲渲染（可見數）：超出可見數的舊訊息掛 content-visibility:auto，
//      瀏覽器可以整段跳過排版與繪製，但節點仍在 DOM 裡 —— 其他插件的
//      querySelector / MutationObserver / 依 msgid 找訊息都照樣運作。
//   2. 自動清除（硬門檻）：訊息數多到真的吃記憶體才物理移除最舊的，
//      且一律停在目前房間分隔線之前，絕不動到目前房間的內容。
//
// 兩者都只在「即時模式」（跟著最新訊息看）運作。使用者往回捲看歷史時進入
// 「閱讀模式」，過濾整批還原、清除暫停，不會把正在讀的東西藏起來或刪掉。
// ════════════════════════════════════════════════════════════════════════════

const LAZY_CLASS = 'lce-msg-lazy';
const STYLE_ID = 'lce-perf-style';

/** 自動清除觸發後保留的訊息數。留一段緩衝，避免卡在門檻邊界每來一則就清一次。 */
const PRUNE_KEEP = 300;

// 捲動比例（0=頂端，1=底端）。兩個門檻留緩衝，避免在臨界值附近小幅捲動就反覆切換模式。
const READING_ENTER_RATIO = 0.5;   // 低於此 → 進入閱讀模式
const READING_EXIT_RATIO = 0.6;    // 高於此 → 回到即時模式

let liveCount = 0;        // 目前 DOM 裡的訊息數
let lazyCount = 0;        // 其中已套用延遲渲染的則數
let lazyCursor = null;    // 增量套用 lazy class 的遊標，避免每則新訊息都整表掃描
let readingMode = false;
let observer = null;
let observedLog = null;

const lazyOn = () => !!getFeature('scrollMaxMessagesEnabled');
const pruneOn = () => !!getFeature('autoPruneMessagesEnabled');
const softLimit = () => bar('scrollMaxMessages');
const hardLimit = () => bar('autoPruneMessages');
/** 清除後保留的訊息數。可見數上限（100）遠低於 PRUNE_KEEP，取大的純粹是防呆。 */
const pruneFloor = () => Math.max(PRUNE_KEEP, softLimit());

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // contain-intrinsic-height 給瀏覽器一個未渲染時的高度估計值，捲軸才不會亂跳。
    s.textContent = `
        .${LAZY_CLASS} {
            content-visibility: auto;
            contain-intrinsic-height: auto 40px;
        }
    `;
    document.head.appendChild(s);
}

const chatLogEl = () => document.getElementById(CHATLOG);

/** 找出某節點之後下一個帶 .ChatMessage 的兄弟節點（跳過其他節點，防禦性寫法）。 */
function nextMessageSibling(node) {
    let sib = node?.nextElementSibling ?? null;
    while (sib && !sib.classList.contains('ChatMessage')) sib = sib.nextElementSibling;
    return sib;
}

/** 依 DOM 現況重新校正計數與遊標（觀察器重掛、清除後、設定變更時用）。 */
function resyncState() {
    const log = chatLogEl();
    liveCount = log ? log.querySelectorAll('.ChatMessage').length : 0;
    lazyCount = log ? log.querySelectorAll('.' + LAZY_CLASS).length : 0;
    lazyCursor = null;
}

/** 捲動比例：0=頂端，1=底端。內容還不夠長（捲不動）時視為在底部。 */
function scrollRatio(log) {
    const maxScroll = log.scrollHeight - log.clientHeight;
    return maxScroll <= 0 ? 1 : log.scrollTop / maxScroll;
}

function onChatScroll() {
    const log = chatLogEl();
    if (!log) return;
    const ratio = scrollRatio(log);
    if (!readingMode && ratio < READING_ENTER_RATIO) enterReadingMode(log);
    else if (readingMode && ratio > READING_EXIT_RATIO) exitReadingMode(log);
}

/** 進入閱讀模式：整批還原延遲渲染，之後新訊息也不過濾，直到回到底部。 */
function enterReadingMode(log) {
    readingMode = true;
    resetAllLazy(log);
}

/** 回到即時模式：重新套用過濾，並把閱讀期間累積的超量訊息補清一次。 */
function exitReadingMode(log) {
    readingMode = false;
    applyLazyFilter(log);
    if (pruneOn() && liveCount > hardLimit()) pruneOldest(liveCount - pruneFloor());
}

/**
 * 整批重算：最舊的 (訊息數 - 可見數) 則掛 lazy，其餘拿掉。
 * 用 toggle 一次處理兩個方向 —— 可見數調大時也要把多出來的還原。
 * 回到即時模式、或使用者改了可見數時呼叫。
 */
function applyLazyFilter(log) {
    const messages = log.querySelectorAll('.ChatMessage');
    const excess = lazyOn() ? Math.max(0, messages.length - softLimit()) : 0;
    for (let i = 0; i < messages.length; i++) messages[i].classList.toggle(LAZY_CLASS, i < excess);
    lazyCount = excess;
    lazyCursor = null;
}

/** 還原所有延遲渲染（進入閱讀模式、或關閉功能時用）。 */
function resetAllLazy(log = chatLogEl()) {
    (log ?? document).querySelectorAll('.' + LAZY_CLASS).forEach(el => el.classList.remove(LAZY_CLASS));
    lazyCount = 0;
    lazyCursor = null;
}

/**
 * 增量套用：只補這次新增訊息造成的差額，不整表掃描。
 *
 * 這裡刻意用 lazyCount 記「已經套用幾則」，而不是拿 (liveCount - 可見數) 當
 * 迴圈次數 —— 後者是「總共該有幾則 lazy」，但迴圈只在真的新掛 class 時遞減，
 * 於是每來一則新訊息就會把已經 lazy 的則數再補一遍，愈滾愈多，最後整串訊息
 * 都被 lazy 掉（可見數形同虛設）。差額才是要補的量。
 */
function applyLazyIncremental() {
    if (!lazyOn()) return;
    const want = liveCount - softLimit();   // 應該被延遲渲染的則數
    let toLazy = want - lazyCount;          // 還差幾則
    if (toLazy <= 0) return;

    if (!lazyCursor) {
        const first = chatLogEl()?.firstElementChild ?? null;
        lazyCursor = first?.classList?.contains('ChatMessage') ? first : nextMessageSibling(first);
    }
    while (toLazy > 0 && lazyCursor) {
        if (!lazyCursor.classList.contains(LAZY_CLASS)) {
            lazyCursor.classList.add(LAZY_CLASS);
            lazyCount++; toLazy--;
        }
        lazyCursor = nextMessageSibling(lazyCursor);
    }
}

/**
 * 物理移除最舊的訊息以釋放記憶體。移除範圍一律停在目前房間分隔線
 * （.chat-room-sep-last）之前，絕不動到目前房間的內容 —— 這跟 BC 原生
 * 「Cut」選單動作的安全邊界一致。
 * @param {number} targetRemoveCount 希望移除的訊息數；實際可能較少
 * @returns {number} 實際移除的訊息數
 */
function pruneOldest(targetRemoveCount) {
    const log = chatLogEl();
    if (!log || targetRemoveCount <= 0) return 0;

    const lastSep = log.querySelector('.chat-room-sep-last');
    if (!lastSep) return 0;   // 還沒有可安全依循的邊界，這輪先不清

    let removed = 0;
    let node = log.firstElementChild;
    while (node && node !== lastSep && removed < targetRemoveCount) {
        const next = node.nextElementSibling;
        if (node.classList.contains('ChatMessage')) removed++;
        node.remove();
        node = next;
    }

    if (removed > 0) {
        // 被移除的都是最舊的、也就是遊標之前那段，計數與遊標整組重算最保險 ——
        // 清除很少發生（幾百則才一次），這裡多掃一遍 DOM 不影響效能。
        resyncState();
        console.debug(LOG, `已釋放 ${removed} 則舊訊息，剩餘 ${liveCount}`);
    }
    return removed;
}

/** 每則新訊息進 DOM 後呼叫一次。閱讀模式下只更新計數。 */
function onMessageAppended() {
    liveCount++;
    if (readingMode) return;
    applyLazyIncremental();
    if (pruneOn() && liveCount > hardLimit()) pruneOldest(liveCount - pruneFloor());
}

function startObserver() {
    const log = chatLogEl();
    if (!log) return;
    if (observer && observedLog === log) return;   // 已在觀察同一個節點

    stopObserver();
    resyncState();
    readingMode = false;   // 換房後聊天區是捲在底部的，不該沿用上一間的閱讀狀態
    observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (!node.classList?.contains('ChatMessage')) continue;
                onMessageAppended();
            }
        }
    });
    observer.observe(log, { childList: true });
    observedLog = log;
    log.addEventListener('scroll', onChatScroll, { passive: true });
}

function stopObserver() {
    observedLog?.removeEventListener('scroll', onChatScroll);
    try { observer?.disconnect(); } catch { /* ignore */ }
    observer = null;
    observedLog = null;
}

/** 設定變更時即時反應，不必等下一則訊息才看到效果。 */
function onCapacitySettingChanged(key) {
    const log = chatLogEl();
    if (!log) return;

    if (key === 'scrollMaxMessages' || key === 'scrollMaxMessagesEnabled') {
        // 閱讀模式下本來就是全部展開，等回到底部再套用
        if (readingMode) return;
        applyLazyFilter(log);   // 關閉時 excess=0，等於整批還原
    } else if (key === 'autoPruneMessages' || key === 'autoPruneMessagesEnabled') {
        resyncState();
        if (pruneOn() && !readingMode && liveCount > hardLimit()) pruneOldest(liveCount - pruneFloor());
    }
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

// ───────────────────────── 低幀率 ─────────────────────────
//
// 不能直接用 BC 自己的 Player.GraphicsSettings.MaxFPS：那個值受伺服器驗證，
// 只接受 PreferenceGraphicsFrameLimit = [0, 10, 15, 30, 60]，填 35 會被打回預設。
// 也不再改寫 window.requestAnimationFrame —— 那會連帶節流所有用到 rAF 的
// 插件與 UI 動畫，不只是遊戲繪製。改成只攔 GameRun，跳幀方式與 BC 本身一致。

function shouldSkipFrame(timestamp) {
    if (!getFeature('lowFrameRateFpsEnabled')) return false;
    if (typeof TimerLastTime !== 'number' || TimerLastTime <= 0 || !(timestamp > 0)) return false;
    return TimerLastTime + 1000 / bar('lowFrameRateFps') > timestamp;
}

// ───────────────────────── FPS 顯示 ─────────────────────────
//
// BC 自己的 Player.GraphicsSettings.ShowFPS 只畫在左上角，而且那段是寫死在
// GameRun 裡的、沒有獨立函式可攔，所以位置要能選就只能自己畫一份。
//
// 但這樣一來，使用者若也開著 BC 原生的 ShowFPS，畫面上就會有兩個數字
// （BC 的固定在左上、我們的在使用者選的位置）。與其去改 Player.GraphicsSettings
// （那是會同步到伺服器的使用者設定，不該我們動手），不如把它那一次繪製攔下來 ——
// 認得出來是因為那行是寫死的：DrawTextFit(數字, 15, 12, 30, "white", "black")。
// 見 BC Game.js 的 GameRun。

/** BC 原生 FPS 那一行的固定簽名（x, y, width）。 */
const BC_FPS_CALL = { x: 15, y: 12, w: 30 };

/** 這一次 DrawTextFit 是不是 BC 自己畫 FPS？ */
function isBcNativeFps(args) {
    return args[1] === BC_FPS_CALL.x && args[2] === BC_FPS_CALL.y && args[3] === BC_FPS_CALL.w;
}

const FPS_XY = {
    tl: [60, 25],   ml: [60, 500],   bl: [60, 975],
    tc: [1000, 25],                  bc: [1000, 975],
    tr: [1940, 25], mr: [1940, 500], br: [1940, 975],
};

/**
 * BC 的預設字級是 36（DrawTextFit 畫完就把字型還原成 CommonGetFont(36)），
 * 依需求縮 4pt。
 */
const FPS_FONT_SIZE = 26;

let fpsLastTs = 0;
let fpsSmooth = 0;

function drawFps() {
    const pos = FPS_XY[getFeature('showFps')] ?? FPS_XY.tl;
    const ctx = window.MainCanvas?.getContext('2d');
    if (!ctx) return;

    const bakAlign = ctx.textAlign;
    const bakFont = ctx.font;
    ctx.textAlign = 'center';
    try {
        // 只畫數字，不加 "FPS"。
        // 用 DrawText 而非 DrawTextFit：後者會自己依寬度把字級從 36 一路縮到塞得下為止，
        // 字級等於被寬度綁架（"144" 會比 "60" 小一號）。這裡要的是固定字級，
        // 所以自己設好字型再畫 —— DrawText 用的就是當下的 MainCanvas.font。
        if (typeof CommonGetFont === 'function') ctx.font = CommonGetFont(FPS_FONT_SIZE);
        DrawText(String(Math.round(fpsSmooth)), pos[0], pos[1], 'White', 'Black');
    } finally {
        ctx.font = bakFont;
        ctx.textAlign = bakAlign;
    }
}

let installed = false;

export function installPerformance() {
    if (installed) return;
    installed = true;

    injectStyle();

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

    // 低幀率：跳幀的作法與 BC GameRun 自己的上限判斷一致 —— 重掛下一幀後直接返回。
    hook('GameRun', 0, (args, next) => {
        if (!shouldSkipFrame(args[0])) return next(args);
        window.GameAnimationFrameId = requestAnimationFrame(window.GameRun);
        return undefined;
    });

    // 我們的 FPS 開著時，把 BC 原生那一份擋掉，畫面上永遠只有一個數字、
    // 而且在使用者選的位置。關掉我們的就原樣放行，BC 照舊畫它的左上角。
    hook('DrawTextFit', 0, (args, next) => {
        if (getFeature('showFpsEnabled') && isBcNativeFps(args)) return undefined;
        return next(args);
    });

    // FPS：DrawProcess 每畫一幀跑一次，跳掉的幀不會進來，所以量到的就是實際幀率。
    hook('DrawProcess', 0, (args, next) => {
        const ret = next(args);
        try {
            if (!getFeature('showFpsEnabled')) { fpsLastTs = 0; fpsSmooth = 0; return ret; }
            const ts = typeof args[0] === 'number' ? args[0] : performance.now();
            if (fpsLastTs > 0 && ts > fpsLastTs) {
                const inst = 1000 / (ts - fpsLastTs);
                // 指數平滑：瞬時值每幀都在跳，讀不出來
                fpsSmooth = fpsSmooth > 0 ? fpsSmooth * 0.9 + inst * 0.1 : inst;
            }
            fpsLastTs = ts;
            if (fpsSmooth > 0) drawFps();
        } catch { /* 畫不出來就算了，不能拖累繪製 */ }
        return ret;
    });

    // 聊天記錄容量：進房 / 換房後重新掛觀察器（容器可能被整個重建）
    hook('ChatRoomSync', 4, (args, next) => {
        const ret = next(args);
        setTimeout(startObserver, 300);
        return ret;
    });
    startObserver();

    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        const key = e.detail?.key;
        try { onCapacitySettingChanged(key); } catch { /* ignore */ }
        try { onTextureSettingChanged(key); } catch { /* ignore */ }
    });
}
