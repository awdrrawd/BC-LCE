import { createHook } from '../../core/hooks.js';
import { getFeature } from '../../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';
const LOG = '🐈‍⬛ [LCE]';
const hook = createHook('performance');
import { DEFAULT_FEATURE_SETTINGS, clampBar } from '../../core/settings-schema.js';
const bar = key => clampBar(DEFAULT_FEATURE_SETTINGS[key], getFeature(key));
const CHATLOG = 'TextAreaChatLog';

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

/**
 * 即時模式下把捲軸釘在底部。
 *
 * 為什麼需要這個：BC 的 ChatRoomAppendChat 是「先判斷 wasAtEnd → append → 若在底部就捲到底」，
 * 這一切在同一個同步區塊內完成。但我們的 MutationObserver 是在那之後才跑，這時才把上面的舊訊息
 * 掛上 content-visibility（高度從實際值塌成估計值），內容整段往上位移 → 剛捲到底的位置就跑掉了，
 * 於是「開了信息節能後新訊息不自動捲到最新」。所以只要還在即時模式（沒在往回讀歷史），
 * 每次有新訊息、且我們動過版面後，就重新把捲軸釘回底部。
 *
 * 用 requestAnimationFrame 合併同一幀內的多則新訊息（進房大量灌訊息時只釘一次），
 * 也讓 content-visibility 造成的版面變動先結算完再讀 scrollHeight。
 */
let pinScheduled = false;
function schedulePinToBottom() {
    if (pinScheduled) return;
    pinScheduled = true;
    requestAnimationFrame(() => {
        pinScheduled = false;
        if (readingMode) return;   // 這一幀之間使用者往回捲了 → 尊重他，不要拉回底部
        const log = chatLogEl();
        if (log) log.scrollTop = log.scrollHeight;
    });
}

/** 每則新訊息進 DOM 後呼叫一次。閱讀模式下只更新計數。 */
function onMessageAppended() {
    liveCount++;
    if (readingMode) return;
    applyLazyIncremental();
    if (pruneOn() && liveCount > hardLimit()) pruneOldest(liveCount - pruneFloor());
    schedulePinToBottom();
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

let installed = false;
export function installChatCapacity() {
    if (installed) return;
    installed = true;
    injectStyle();
    // 聊天記錄容量：進房 / 換房後重新掛觀察器（容器可能被整個重建）
    hook('ChatRoomSync', 4, (args, next) => {
        const ret = next(args);
        setTimeout(startObserver, 300);
        return ret;
    });
    startObserver();

    window.addEventListener(SETTING_CHANGED_EVENT, e => {
        try { onCapacitySettingChanged(e.detail?.key); } catch { /* ignore */ }
    });
}
