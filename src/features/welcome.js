// ════════════════════════════════════════════════════════════════════════════
// 進房歡迎訊息 —— 沒有設定，一律啟用
//
// 每次登入後第一次進聊天室時，在聊天區留一則本地訊息：LCE 已載入、版本、
// 以及去哪裡看指令與設定。只有第一次進房會出現，之後換房不再重播 ——
// 跟 BCX 指令教學的處理一致（見 features/local-messages.js）。
//
// 為什麼不在載入完成時就送：那時還沒有聊天室，訊息無處可放。
// ChatRoomAppendChat 需要 #TextAreaChatLog 已經建好，所以只能等進房。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { T } from '../core/i18n.js';
import { lceChatNotify } from '../commands/commander.js';

const LOG = '🐈‍⬛ [LCE]';

/** 只活在這次連線期間：重新登入後應該要再看到一次。 */
let shown = false;

function buildMessage() {
    const rows = [
        T('welcome_loaded').replace('$ver', MOD_VER),
        T('welcome_intro'),
        T('welcome_hint'),
    ];
    const wrap = document.createElement('div');
    for (const text of rows) {
        const row = document.createElement('div');
        row.className = 'lce-welcome-row';
        row.textContent = text;
        wrap.appendChild(row);
    }
    return wrap;
}

function showOnce() {
    if (shown) return;
    // 聊天區還沒建好就先不送，讓下一次 ChatRoomSync 再試 —— 不留旗標，才有下一次。
    if (!document.getElementById('TextAreaChatLog')) return;
    // 旗標等送成功才立：先立的話，這次丟例外（例如別的插件的 hook 出錯）
    // 就等於整場都不會再試，使用者永遠看不到。
    try {
        lceChatNotify(buildMessage());
        shown = true;
    } catch (e) {
        console.warn(LOG, '歡迎訊息顯示失敗，下次進房再試:', e);
    }
}

let installed = false;

export function installWelcome() {
    if (installed) return;
    installed = true;

    try {
        // ChatRoomSync 是進房與換房都會走的同步點，此時聊天區已經存在。
        // 延遲一拍再送，讓 BC 先把自己的進房訊息（房間描述等）鋪完，我們的接在後面。
        modApi.hookFunction('ChatRoomSync', 4, (args, next) => {
            const ret = next(args);
            if (!shown) setTimeout(showOnce, 800);
            return ret;
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomSync hook 未掛上，歡迎訊息停用:', e?.message ?? e);
    }
}
