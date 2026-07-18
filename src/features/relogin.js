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
import { loadAccounts, decryptPassword } from '../core/storage.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';

let breakCircuit = false;       // 單次重連進行中
let breakCircuitFull = false;   // 永久停止（重整前不再嘗試）
let loginError = null;

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
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
    if (!getFeature('relogin')) return;
    if (!Player?.AccountName || LoginSubmitted || breakCircuit || breakCircuitFull) return;
    if (typeof ServerSocket === 'undefined' || !ServerSocket?.connected) return;

    breakCircuit = true;
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
    if (!ok) { console.warn(LOG, '自動重連失敗'); return; }

    setTimeout(() => notify(T('relogin_title'), T('relogin_done')), 500);
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
            if (r && typeof r === 'object') breakCircuit = false;   // 登入成功 → 重置斷路器
        } catch { /* ignore */ }
        return next(args);
    });

    // ── 異地登入 / 限流的強制斷線處理（移植 WCE automaticReconnect 的 ServerDisconnect hook）──
    // 「被踢下線」的真正原因只會從 ServerDisconnect（force=true）帶進來，不會經過 LoginResponse；
    // 少了這個 hook，就抓不到「在別處登入」，兩邊會不停互相把對方踢掉、輪流搶登。
    //   • ErrorDuplicatedLogin（在別處登入）→ 永久停止自動重連（breakCircuitFull），只提示一次。
    //   • ErrorRateLimited（被限流）→ 隔 3~6 秒（隨機抖動，避開同時重連）再連一次。
    hook('ServerDisconnect', 6, (args, next) => {
        const [error, force] = args;
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

    // socket 重新連上 → 重置斷路器與上次錯誤（同 WCE registerSocketListener("connect")）
    (function bindConnect(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n <= 0) return;
            setTimeout(() => bindConnect(n - 1), 500);
            return;
        }
        try { ServerSocket.on('connect', () => { breakCircuit = false; loginError = null; }); } catch { /* ignore */ }
    })();
}
