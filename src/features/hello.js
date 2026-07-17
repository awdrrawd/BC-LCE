// ════════════════════════════════════════════════════════════════════════════
// BCEMsg 打招呼協定 —— 移植自 WCE hiddenMessageHandler.ts / shareAddons.ts
//
// 這是 /versions 能看到別人的唯一來源。BC 伺服器不提供「對方裝了什麼插件」的欄位，
// 所以 WCE 自己定了一套隱藏訊息：進房 / 有人加入時，用 Type="Hidden"、
// Content="BCEMsg" 的聊天訊息把自己的插件清單廣播出去，收到的人寫進
// character.FBCOtherAddons。沒有這一段，FBCOtherAddons 永遠只有自己那份，
// /versions 看別人就只剩俱樂部版本。
//
// 線路格式與 WCE 完全一致，所以裝 WCE 的人也看得到我們、我們也看得到他們。
//
// 注意 capabilities 一律送空陣列：那是 WCE 用來宣告「我支援 clubslave / layering」
// 的欄位，LCE 沒有實作這些功能。謊報會讓 WCE 使用者對我們送出永遠不會生效的請求。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';

const HIDDEN = 'Hidden';
const BCE_MSG = 'BCEMsg';
const MSG_HELLO = 'Hello';

const inChatRoom = () =>
    typeof ServerIsConnected !== 'undefined' && ServerIsConnected
    && typeof ServerPlayerIsInChatRoom === 'function' && ServerPlayerIsInChatRoom();

/**
 * 廣播（或對單一對象發送）自己的版本與插件清單。
 * @param {number|null} target        指定對象的會員編號；null = 廣播給整個房間
 * @param {boolean} requestReply      要求對方也回報一次（進房時用，否則看不到既有的人）
 */
export function sendHello(target = null, requestReply = false) {
    if (!inChatRoom()) return;
    try {
        const payload = {
            type: MSG_HELLO,
            version: MOD_VER,
            alternateArousal: false,
            replyRequested: requestReply,
            capabilities: [],
        };
        if (getFeature('shareAddons')) {
            payload.otherAddons = window.bcModSdk?.getModsInfo?.() ?? [];
        }
        const message = {
            Type: HIDDEN,
            Content: BCE_MSG,
            Sender: Player.MemberNumber,
            Dictionary: [{ message: payload }],
        };
        if (target) message.Target = target;
        ServerSend('ChatRoomChat', message);
    } catch (e) {
        console.warn(LOG, 'sendHello 失敗:', e);
    }
}

/** Dictionary 可能是陣列或單一物件（WCE 兩種都收，我們照做）。 */
function parseMessage(data) {
    if (Array.isArray(data.Dictionary)) return data.Dictionary.find(t => t?.message)?.message || {};
    return data.Dictionary?.message || {};
}

function processHello(sender, msg) {
    sender.FBC = msg.version ?? '0.0';
    sender.BCECapabilities = msg.capabilities ?? [];
    sender.FBCOtherAddons = msg.otherAddons;
    // 對方要求回報時只回他一個人，且不再要求回覆 —— 否則兩邊會無限互相打招呼
    if (msg.replyRequested) sendHello(sender.MemberNumber, false);
}

function onMessage(data) {
    if (data?.Type !== HIDDEN || data?.Content !== BCE_MSG) return;
    try {
        const sender = Character.find(a => a.MemberNumber === data.Sender);
        if (!sender) return;
        const msg = parseMessage(data);
        if (msg.type === MSG_HELLO) processHello(sender, msg);
    } catch (e) {
        console.warn(LOG, '處理 BCEMsg 失敗:', e);
    }
}

let installed = false;

export function installHello() {
    if (installed) return;
    installed = true;

    const bind = () => {
        try {
            ServerSocket?.on('ChatRoomMessage', onMessage);
            // 有人進房 → 對他打招呼（不必要求回覆，他自己進房時會廣播）
            ServerSocket?.on('ChatRoomSyncMemberJoin', (data) => {
                if (data?.SourceMemberNumber !== Player.MemberNumber) sendHello(data.SourceMemberNumber, false);
            });
            // 自己進房 / 房間同步 → 廣播並要求既有成員回報
            ServerSocket?.on('ChatRoomSync', () => sendHello(null, true));
        } catch { /* ignore */ }
    };

    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n <= 0) { console.warn(LOG, '找不到 ServerSocket，BCEMsg 未啟用'); return; }
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        bind();
        try { modApi.hookFunction('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; }); }
        catch { /* ignore */ }
    })();
}
