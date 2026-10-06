import { createSocketBinding } from '../../core/lifecycle.js';
import { createHook } from '../../core/hooks.js';
// ════════════════════════════════════════════════════════════════════════════
// 斷線重連（relogin）—— 參考 WCE automaticReconnect.js 的 hook / socket 邏輯，
// 但登入憑證採 LCE 自己的加密帳號庫，並在斷線 hot path 使用 session cache，避免 async race。
//
// 刻意的差異：WCE 自帶一整套 AES-GCM 加密密碼庫（wce-saved-accounts）。
// LCE 早已有獨立的帳號／憑證儲存層（與 MPL 共用），所以**不重複造一份**，
// 直接用登入頁保存的帳號。也就是說：要能自動重連，就得先在登入頁保存過該帳號。
//
// 斷路器（breakCircuit）：避免重連失敗時無限重試；
// 若是「在別處登入」造成的斷線，則完全停止（否則兩邊會互踢）。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../../modsdk.js';
import { getFeature } from '../../core/feature-settings.js';
import { shouldLceHandle } from '../../core/wce-compat.js';
import {
    cacheReconnectPassword, getReconnectPassword, warmReconnectPassword,
} from '../../storage/reconnect-credentials.js';
import { T } from '../../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';

let breakCircuit = false;       // 單次重連進行中
let breakCircuitFull = false;   // 永久停止（重整前不再嘗試）
let relogInFlight = false;      // 已送出 LoginDoLogin，等待本次 Relog 結束
let loginError = null;

// ── 重連時保住聊天紀錄 ──
// BC 的聊天紀錄主要存在 DOM。完整重登時 ChatRoom 會被重新建立，舊的 #TextAreaChatLog
// 可能因此消失。LCE 在斷線當下先記下「訊息本身」，回房後不再猜 400ms 的固定時序，
// 而是在 BC 通知重連／回房或新 ChatLog 建立時嘗試，只補回缺失的訊息；不對伺服器重連設定時間上限。
const CHATLOG_ID = 'TextAreaChatLog';
let chatSnapshot = null;   // { html, stamp, count }
let snapshotSeq = 0;
let chatRestoreBodyObserver = null;
let chatRestoreLogObserver = null;

function disconnectChatRestoreObservers() {
    chatRestoreBodyObserver?.disconnect();
    chatRestoreLogObserver?.disconnect();
    chatRestoreBodyObserver = null;
    chatRestoreLogObserver = null;
}

function cancelChatRestore() {
    disconnectChatRestoreObservers();
}

function chatMessageKey(el) {
    if (!el) return '';
    const attrs = ['data-time', 'data-sender', 'data-target', 'data-msgid', 'data-type']
        .map(name => el.getAttribute?.(name) ?? '').join('|');
    return `${el.className}|${attrs}|${el.textContent ?? ''}`;
}

/** 斷線當下只保存 ChatMessage，避免把 separator / 其他插件 UI 一起重播。 */
function snapshotChatLog() {
    try {
        cancelChatRestore();
        const log = document.getElementById(CHATLOG_ID);
        if (!log) return;
        const messages = [...log.querySelectorAll('.ChatMessage')];
        if (messages.length === 0) return;
        const stamp = `lce-${++snapshotSeq}-${Date.now()}`;
        log.dataset.lceChatStamp = stamp;
        chatSnapshot = {
            html: messages.map(message => message.outerHTML).join(''),
            stamp,
            count: messages.length,
        };
    } catch (e) { console.warn(LOG, '快照聊天紀錄失敗:', e?.message ?? e); }
}

/**
 * 把快照裡目前 ChatLog 沒有的訊息補到最前面。
 * 只用 data-* + class + text 做輕量 dedupe，避免 BC 已經恢復一部分歷史時產生大量重複。
 */
function mergeChatSnapshot(log, snap) {
    if (!log || !snap?.html) return 0;
    const currentCounts = new Map();
    for (const message of log.querySelectorAll('.ChatMessage')) {
        const key = chatMessageKey(message);
        currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
    }

    const template = document.createElement('template');
    template.innerHTML = snap.html;
    const missing = [];
    for (const node of [...template.content.children]) {
        const key = chatMessageKey(node);
        const count = currentCounts.get(key) ?? 0;
        if (count > 0) currentCounts.set(key, count - 1);
        else missing.push(node);
    }
    if (missing.length === 0) return 0;

    const fragment = document.createDocumentFragment();
    for (const node of missing) {
        node.dataset.lceRelogRestored = snap.stamp;
        fragment.appendChild(node);
    }
    log.insertBefore(fragment, log.firstChild);
    return missing.length;
}

function restoreChatLogIfWiped() {
    if (!chatSnapshot) return false;
    const log = document.getElementById(CHATLOG_ID);
    if (!log) return false;
    const snap = chatSnapshot;
    const currentCount = log.querySelectorAll('.ChatMessage').length;
    const preserved = log.dataset.lceChatStamp === snap.stamp;

    // 同一元素仍有內容：沒有被清空。
    if (preserved && currentCount > 0) {
        chatSnapshot = null;
        cancelChatRestore();
        return true;
    }
    // BC 已經恢復至少同等數量的訊息，不再重播。
    if (currentCount >= snap.count) {
        chatSnapshot = null;
        cancelChatRestore();
        return true;
    }

    try {
        const restored = mergeChatSnapshot(log, snap);
        if (restored > 0) {
            const sep = document.createElement('div');
            sep.className = 'lce-relog-restored';
            sep.style.cssText = 'text-align:center;opacity:.55;font-size:.85em;margin:.35em 0;';
            sep.textContent = `— ${T('relogin_restored')} —`;
            log.insertBefore(sep, log.querySelector('.ChatMessage') ?? log.firstChild);
            console.info(LOG, `已還原重連前的 ${restored} 則聊天紀錄`);
        }
        chatSnapshot = null;
        cancelChatRestore();
        return true;
    } catch (e) {
        console.warn(LOG, '還原聊天紀錄失敗:', e?.message ?? e);
        return false;
    }
}

function nodeContainsChatLog(node) {
    if (!(node instanceof Element)) return false;
    return node.id === CHATLOG_ID || !!node.querySelector?.(`#${CHATLOG_ID}`);
}

/**
 * 等的是 DOM 事件，不是伺服器時間：斷線多久都不影響自動重連。
 * 若 ChatLog 尚不存在，Observer 只等待 ChatLog 本身出現；一旦出現就立即嘗試恢復。
 */
function ensureChatRestoreObservers() {
    if (!chatSnapshot || typeof document === 'undefined') return;

    const log = document.getElementById(CHATLOG_ID);
    if (log && !chatRestoreLogObserver) {
        chatRestoreLogObserver = new MutationObserver(() => {
            if (!chatSnapshot) return;
            restoreChatLogIfWiped();
        });
        chatRestoreLogObserver.observe(log, { childList: true, subtree: true });
    }

    if (chatRestoreBodyObserver || !document.body) return;
    chatRestoreBodyObserver = new MutationObserver(mutations => {
        if (!chatSnapshot) return;
        const hasChatLogChange = mutations.some(mutation =>
            [...mutation.addedNodes].some(nodeContainsChatLog));
        if (!hasChatLogChange) return;
        if (restoreChatLogIfWiped()) return;
        const newLog = document.getElementById(CHATLOG_ID);
        if (newLog && !chatRestoreLogObserver) {
            chatRestoreLogObserver = new MutationObserver(() => {
                if (!chatSnapshot) return;
                restoreChatLogIfWiped();
            });
            chatRestoreLogObserver.observe(newLog, { childList: true, subtree: true });
        }
    });
    chatRestoreBodyObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * 只在 BC 已經通知「重新登入／回房／socket 重建」等生命週期事件時嘗試一次。
 * 不使用固定 10 秒 timeout，也不阻塞或停止伺服器重連。
 */
function scheduleChatLogRestore() {
    if (!chatSnapshot) return;
    if (restoreChatLogIfWiped()) return;
    ensureChatRestoreObservers();
}

// ── 重試節流 ──
// 症狀：連線不穩時 socket.io 會反覆 connect/disconnect，而我們的 'connect' 監聽每次都把 breakCircuit
// 重置，於是 RelogRun 立刻又送一次 LoginDoLogin。登入請求擠成一團 → 反而更容易踩到伺服器的限流
// （ErrorRateLimited），最後 breakCircuit 卡住、使用者只好自己重打密碼。
// 對策：兩次「真正送出登入」之間至少間隔 backoff；失敗就把間隔加倍（指數退避），成功則歸零。
// 這樣 socket 一直閃，登入嘗試也不會比 backoff 更密。
const RELOG_MIN_INTERVAL = 5000;    // 最短重試間隔
const RELOG_MAX_INTERVAL = 60000;   // 退避上限
let lastAttempt = 0;
let backoff = RELOG_MIN_INTERVAL;

const hook = createHook('relogin', () => shouldLceHandle('relogin'));

/** 用 BC 內建的 beep 提示（不經伺服器，純本地顯示）。 */
function notify(title, message) {
    try {
        modApi.callOriginal('ServerAccountBeep', [{
            MemberNumber: Player?.MemberNumber || -1,
            BeepType: '', MemberName: 'LCE', ChatRoomName: title,
            Private: true, Message: message, ChatRoomSpace: '',
        }]);
    } catch { /* ignore */ }
}

/** 背景預熱目前帳號的重連密碼；真正重連時只讀 session cache，不在斷線 hot path 等 WebCrypto。 */
function warmCurrentPassword() {
    if (!getFeature('relogin') || typeof Player === 'undefined' || !Player?.AccountName) return;
    void warmReconnectPassword(Player.AccountName);
}

function waitRelogResult() {
    (async () => {
        let n = 120;
        while (relogInFlight) {
            if (typeof CurrentScreen !== 'undefined' && CurrentScreen !== 'Relog') {
                relogInFlight = false;
                backoff = RELOG_MIN_INTERVAL;
                setTimeout(() => notify(T('relogin_title'), T('relogin_done')), 500);
                return;
            }
            if (n-- <= 0) {
                relogInFlight = false;
                backoff = Math.min(backoff * 2, RELOG_MAX_INTERVAL);
                console.warn(LOG, `自動重連失敗，下次至少間隔 ${backoff / 1000}s`);
                breakCircuit = false;
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    })();
}

function submitRelogin(accountName, pass) {
    if (!accountName || !pass) return false;
    breakCircuit = true;
    relogInFlight = true;
    lastAttempt = Date.now();
    cacheReconnectPassword(accountName, pass);
    console.info(LOG, '嘗試自動重新登入:', accountName);
    try {
        LoginDoLogin(accountName, pass);
        waitRelogResult();
        return true;
    } catch (e) {
        console.warn(LOG, '送出自動重連失敗:', e?.message ?? e);
        breakCircuit = false;
        relogInFlight = false;
        return false;
    }
}

function relog() {
    if (!shouldLceHandle('relogin')) return;
    if (!Player?.AccountName || LoginSubmitted || breakCircuit || relogInFlight || breakCircuitFull) return;
    if (typeof ServerSocket === 'undefined' || !ServerSocket?.connected) return;
    if (Date.now() - lastAttempt < backoff) return;

    const accountName = Player.AccountName;
    const pass = getReconnectPassword(accountName);
    if (pass) {
        submitRelogin(accountName, pass);
        return;
    }

    // 冷啟動極少數情況：密碼快取尚未預熱。不要在 RelogRun hook 裡 await WebCrypto；
    // 背景解密完成後再直接提交登入，避免讓 BC 的 RelogRun 生命週期被 async hook 卡住。
    breakCircuit = true;
    void warmReconnectPassword(accountName).then(plain => {
        if (!plain) {
            console.warn(LOG, '沒有可用的保存密碼，無法自動重連:', accountName, '（請先在登入頁保存此帳號）');
            breakCircuit = false;
            breakCircuitFull = true;
            relogInFlight = false;
            return;
        }
        if (breakCircuitFull || typeof CurrentScreen !== 'undefined' && CurrentScreen !== 'Relog' || typeof ServerSocket === 'undefined' || !ServerSocket?.connected || LoginSubmitted) {
            breakCircuit = false;
            return;
        }
        breakCircuit = false;
        submitRelogin(accountName, plain);
    });
}

/**
 * 診斷用：在 console 執行 `Liko.LCE.debugRelogSnapshot()`，看斷線快照有沒有拍到。
 * 判讀：斷線後（回房前）pendingSnapshot 應為 true、snapshotCount 是斷線前的則數；
 * 若一直是 false，代表斷線沒經過 ServerDisconnect、快照沒觸發（那要換更早的抓法）。
 * ChatLog 恢復沒有時間上限；快照會留到 BC 下一次建立 ChatLog 並成功合併為止。
 */
export function debugRelogSnapshot() {
    const log = document.getElementById(CHATLOG_ID);
    const info = {
        pendingSnapshot: !!chatSnapshot,
        snapshotCount: chatSnapshot?.count ?? 0,
        logExists: !!log,
        currentMessages: log ? log.querySelectorAll('.ChatMessage').length : null,
    };
    console.info(LOG, '重連快照狀態:', info);
    return info;
}

let installed = false;

export function installRelogin() {
    if (installed) return;
    installed = true;
    warmCurrentPassword();

    hook('RelogRun', 100, (args, next) => {
        if (loginError !== 'ErrorDuplicatedLogin') {
            relog();
        } else if (!breakCircuit) {
            // 在別處登入 → 再重連會互踢，直接停止
            notify(T('relogin_error'), T('relogin_duplicate'));
            breakCircuit = true;
            breakCircuitFull = true;
        }
        return next(args);
    });

    hook('RelogExit', 100, (args, next) => {
        breakCircuit = false;
        breakCircuitFull = false;
        relogInFlight = false;
        loginError = null;   // 離開重連畫面 → 清掉上一次的斷線原因（同 WCE）
        scheduleChatLogRestore();
        return next(args);
    });

    // 記錄登入錯誤原因，供上面判斷是否為「在別處登入」
    hook('LoginClick', 100, (args, next) => {
        try {
            if (getFeature('relogin')) {
                const name = typeof ElementValue === 'function' ? ElementValue('InputName') : document.getElementById('InputName')?.value;
                const pass = typeof ElementValue === 'function' ? ElementValue('InputPassword') : document.getElementById('InputPassword')?.value;
                if (name && pass) cacheReconnectPassword(name, pass);
            }
        } catch { /* ignore */ }
        return next(args);
    });

    hook('LoginResponse', 100, (args, next) => {
        try {
            const r = args[0];
            loginError = typeof r === 'string' ? r : null;
            warmCurrentPassword();
            if (r && typeof r === 'object') { backoff = RELOG_MIN_INTERVAL; }   // 登入成功資料到達；由 RelogExit / connect 結束本次斷路器
        } catch { /* ignore */ }
        return next(args);
    });

    // 重連回房 → 嘗試恢復斷線前的聊天訊息。除了 ChatRoomSync，也看 LoginStatusReset / socket connect，
    // 不假設固定 400ms；等新 ChatLog 真正出現後再做一次安全合併。
    hook('ChatRoomSync', 3, (args, next) => {
        const ret = next(args);
        scheduleChatLogRestore();
        return ret;
    });

    hook('LoginStatusReset', 3, (args, next) => {
        const ret = next(args);
        scheduleChatLogRestore();
        return ret;
    });

    // ── 異地登入 / 限流的強制斷線處理（移植 WCE automaticReconnect 的 ServerDisconnect hook）──
    // 「被踢下線」的真正原因只會從 ServerDisconnect（force=true）帶進來，不會經過 LoginResponse；
    // 少了這個 hook，就抓不到「在別處登入」，兩邊會不停互相把對方踢掉、輪流搶登。
    //   • ErrorDuplicatedLogin（在別處登入）→ 永久停止自動重連（breakCircuitFull），只提示一次。
    //   • ErrorRateLimited（被限流）→ 隔 3~6 秒（隨機抖動，避開同時重連）再連一次。
    hook('ServerDisconnect', 6, (args, next) => {
        const [error, force] = args;
        // 斷線當下聊天 DOM 還完整 —— 趁被 BC 拆掉前先快照（回房時若被清空再補回）。
        snapshotChatLog();
        // 交回 BC 時把 force 改成 false：避免 BC 直接進入它自己的強制斷線流程，改由我們接管重連。
        const ret = next([error, false]);
        if (force) {
            console.warn(LOG, '被強制斷線:', error);
            try { ServerSocket?.disconnect(); } catch { /* ignore */ }
            if (typeof error === 'string' && (error === 'ErrorDuplicatedLogin' || error === 'ErrorRateLimited')) {
                loginError = error;
                if (error === 'ErrorDuplicatedLogin') {
                    if (!breakCircuitFull) notify(T('relogin_error'), T('relogin_duplicate'));
                    breakCircuit = true;
                    breakCircuitFull = true;
                    relogInFlight = false;   // 不再自動重連，避免互踢；使用者重整頁面即可恢復
                } else {
                    console.warn(LOG, '被限流，數秒後重新連線…');
                    setTimeout(() => { try { if (typeof ServerInit === 'function') ServerInit(); } catch { /* ignore */ } },
                        3000 + Math.round(Math.random() * 3000));
                }
            }
        }
        return ret;
    });

    // socket 重新連上 → 重置斷路器與上次錯誤（同 WCE registerSocketListener("connect")）。
    //
    // 關鍵修正：ServerInit() 會 `ServerSocket = io(...)` 建立「全新的 socket」，舊 socket 上的
    // 監聽全部作廢。若只在啟動時綁一次（過去的寫法），那麼——特別是我們自己在「被限流」時呼叫的
    // ServerInit——換掉 socket 之後，這個 connect 監聽就再也不會觸發，breakCircuit / loginError
    // 便永遠不會被重置：斷路器一旦關上就卡死，自動重連停擺，使用者只能手動重打密碼。
    // 這正是「限流後就要手動輸入密碼」的根因。
    //
    // 對策與其他模組一致（expressions / hello / misc / friend-presence 都這樣做，也就是 WCE
    // appendSocketListenersToInit 的做法）：每次 ServerInit 後把監聽重新掛到新的 socket 上。
    const socketBinding = createSocketBinding({ connect: () => { if (!relogInFlight) breakCircuit = false; loginError = null; warmCurrentPassword(); scheduleChatLogRestore(); } });
    const bindConnect = () => socketBinding.bind(typeof ServerSocket === 'undefined' ? null : ServerSocket);
    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n <= 0) return;
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        bindConnect();
        hook('ServerInit', 10, (args, next) => { const r = next(args); bindConnect(); return r; });
    })();
}
