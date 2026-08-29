// ════════════════════════════════════════════════════════════════════════════
// 斷線重連（relogin）—— 邏輯移植自 WCE automaticReconnect.js
//
// 刻意的差異：WCE 自帶一整套 AES-GCM 加密密碼庫（wce-saved-accounts）。
// LCE 早就有同樣的東西（core/storage.js，與 MPL 共用帳號/密碼），所以**不重複造一份**，
// 直接用登入頁保存的帳號。也就是說：要能自動重連，就得先在登入頁保存過該帳號。
//
// 斷路器（breakCircuit）：避免重連失敗時無限重試；
// 若是「在別處登入」造成的斷線，則完全停止（否則兩邊會互踢）。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { shouldLceHandle } from '../core/wce-compat.js';
import { loadAccounts, decryptPassword } from '../core/storage.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';

let breakCircuit = false;       // 單次重連進行中
let breakCircuitFull = false;   // 永久停止（重整前不再嘗試）
let loginError = null;

// ── 重連時保住聊天紀錄 ──
// BC 的聊天紀錄「只存在 DOM」（#TextAreaChatLog 的子節點），沒有可重播的陣列。重連走完整
// 重登（LoginDoLogin）時，BC 會短暫離開房間 → ElementRemove 掉聊天區 → 回房時 ChatRoomSync
// 只給你一個全新的空 div，歷史就永久消失（BC 自己也補不回來）。這就是「重連後聊天有機率被
// 清空」的根因。對策：斷線當下（DOM 還完整）先快照,回房後若發現聊天區被重建成空的就補回去。
// 刻意不動下面那套調校過的重連/限流邏輯（全是「根因」註解），改用零侵入的旁路。
const CHATLOG_ID = 'TextAreaChatLog';
let chatSnapshot = null;   // { html, stamp, count }
let snapshotSeq = 0;

/** 斷線當下把聊天紀錄與其所在元素的識別戳記存下來。 */
function snapshotChatLog() {
    try {
        const log = document.getElementById(CHATLOG_ID);
        if (!log) return;
        const count = log.querySelectorAll('.ChatMessage').length;
        if (count === 0) return;   // 沒東西可救
        const stamp = `lce-${++snapshotSeq}-${Date.now()}`;
        log.dataset.lceChatStamp = stamp;   // 蓋在「這個」元素上；重建後的新元素不會有
        chatSnapshot = { html: log.innerHTML, stamp, count };
    } catch (e) { console.warn(LOG, '快照聊天紀錄失敗:', e?.message ?? e); }
}

/**
 * 回房後檢查：聊天區若是被重建成空的（元素換了新的、戳記對不上），就把快照補回最上方。
 * 靠「元素識別戳記」而非單純數訊息數 —— 這樣 performance 的容量修剪（同一元素、砍掉舊訊息）
 * 不會被誤判成「被清空」而重塞造成重複。
 */
function restoreChatLogIfWiped() {
    if (!chatSnapshot) return;
    const log = document.getElementById(CHATLOG_ID);
    if (!log) return;   // 房間還沒建好 → 保留快照，讓下一次 ChatRoomSync 再試
    const snap = chatSnapshot;
    const preserved = log.dataset.lceChatStamp === snap.stamp;   // 同一個元素還在
    const currentCount = log.querySelectorAll('.ChatMessage').length;
    // 原元素還在且仍有內容 → 沒被清，跳過。
    // （只認戳記還不夠：萬一 BC 是就地 innerHTML 清空、元素沒換，戳記仍在但內容沒了 ——
    //   所以還要求「仍有內容」，讓那種情況掉進下面的還原。快照本就要求 count>0，故空房不會誤觸。）
    if (preserved && currentCount > 0) { chatSnapshot = null; return; }
    // 新元素已含同等以上內容 → 避免重複塞
    if (currentCount >= snap.count) { chatSnapshot = null; return; }
    try {
        const sep = `<div class="lce-relog-restored" style="text-align:center;opacity:.55;font-size:.85em;margin:.35em 0;">— ${T('relogin_restored')} —</div>`;
        log.insertAdjacentHTML('afterbegin', snap.html + sep);   // 歷史補回最上方，新訊息仍在其下
        console.info(LOG, `已還原重連前的 ${snap.count} 則聊天紀錄`);
    } catch (e) { console.warn(LOG, '還原聊天紀錄失敗:', e?.message ?? e); }
    chatSnapshot = null;
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

function hook(name, priority, fn) {
    try {
        modApi.hookFunction(name, priority, (args, next) =>
            shouldLceHandle('relogin') ? fn(args, next) : next(args));
    }
    catch (e) { console.warn(LOG, 'relogin hook 未掛上:', name, e?.message ?? e); }
}

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

/** 從 LCE 的帳號庫取出目前帳號的密碼。 */
async function savedPassword(accountName) {
    try {
        const acc = loadAccounts().find(a => a.accountName === accountName);
        if (!acc) return null;
        return await decryptPassword(acc.password);
    } catch (e) { console.warn(LOG, '讀取保存密碼失敗:', e); return null; }
}

async function relog() {
    if (!shouldLceHandle('relogin')) return;
    if (!Player?.AccountName || LoginSubmitted || breakCircuit || breakCircuitFull) return;
    if (typeof ServerSocket === 'undefined' || !ServerSocket?.connected) return;

    // 節流：距上次送出登入還不到 backoff 就先不試（不設 breakCircuit，讓下一幀再來檢查）。
    // 這一步擋住了「socket 一 connect 就立刻再登一次」的連環轟炸。
    if (Date.now() - lastAttempt < backoff) return;

    breakCircuit = true;
    lastAttempt = Date.now();
    const pass = await savedPassword(Player.AccountName);
    if (!pass) {
        console.warn(LOG, '沒有保存的密碼，無法自動重連:', Player.AccountName, '（請先在登入頁保存此帳號）');
        breakCircuitFull = true;   // 沒密碼就別再試了，否則每幀都白跑
        return;
    }

    console.info(LOG, '嘗試自動重新登入:', Player.AccountName);
    LoginDoLogin(Player.AccountName, pass);

    // 等離開 Relog 畫面（成功）或斷路器被重置
    const ok = await new Promise((resolve) => {
        let n = 120;
        (function wait() {
            if (typeof CurrentScreen !== 'undefined' && CurrentScreen !== 'Relog') return resolve(true);
            if (!breakCircuit || n-- <= 0) return resolve(false);
            setTimeout(wait, 500);
        })();
    });
    if (!ok) {
        // 失敗 → 拉長下次間隔，避免持續失敗時愈試愈密
        backoff = Math.min(backoff * 2, RELOG_MAX_INTERVAL);
        console.warn(LOG, `自動重連失敗，下次至少間隔 ${backoff / 1000}s`);
        // 失敗也要放開斷路器，否則 breakCircuit 卡在 true，之後每次 relog() 都在開頭直接 return，
        // 斷路器永遠關不掉、再也不會重連（過去要靠 connect 監聽來放開，但那個監聽在 ServerInit
        // 換掉 socket 後就失效了 —— 見下方 bindConnect）。節流仍由 lastAttempt/backoff 把關，不會狂送。
        breakCircuit = false;
        return;
    }

    backoff = RELOG_MIN_INTERVAL;   // 成功 → 退避歸零
    setTimeout(() => notify(T('relogin_title'), T('relogin_done')), 500);
}

/**
 * 診斷用：在 console 執行 `Liko.LCE.debugRelogSnapshot()`，看斷線快照有沒有拍到。
 * 判讀：斷線後（回房前）pendingSnapshot 應為 true、snapshotCount 是斷線前的則數；
 * 若一直是 false，代表斷線沒經過 ServerDisconnect、快照沒觸發（那要換更早的抓法）。
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
        loginError = null;   // 離開重連畫面 → 清掉上一次的斷線原因（同 WCE）
        return next(args);
    });

    // 記錄登入錯誤原因，供上面判斷是否為「在別處登入」
    hook('LoginResponse', 100, (args, next) => {
        try {
            const r = args[0];
            loginError = typeof r === 'string' ? r : null;
            if (r && typeof r === 'object') { breakCircuit = false; backoff = RELOG_MIN_INTERVAL; }   // 登入成功 → 重置斷路器與退避
        } catch { /* ignore */ }
        return next(args);
    });

    // 重連回房 → 若聊天區被重建成空的，把斷線前的快照補回去。
    // ChatRoomSync 是重連後回到房間的同步點；延遲一下等 BC 把聊天區元素重建好再檢查。
    // 沒有待還原的快照時（一般進房 / 換房）restoreChatLogIfWiped 直接 no-op。
    hook('ChatRoomSync', 3, (args, next) => {
        const ret = next(args);
        setTimeout(restoreChatLogIfWiped, 400);
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
                    breakCircuitFull = true;   // 不再自動重連，避免互踢；使用者重整頁面即可恢復
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
    const bindConnect = () => {
        try { ServerSocket?.on('connect', () => { breakCircuit = false; loginError = null; }); }
        catch { /* ignore */ }
    };
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
