// ════════════════════════════════════════════════════════════════════════════
// 打招呼協定 —— 雙頻道：收 WCE 的，送自己的
//
// BC 伺服器不提供「對方裝了什麼插件」的欄位，所以這類資訊得靠玩家之間自己用
// Type="Hidden" 的聊天訊息互報。Hidden 訊息不會顯示在聊天室裡（BC 的
// ChatRoomMessage 一看到 Type="Hidden" 就 return，連渲染都不進去），BC 自己也是
// 這樣傳 TakeSuitcase / RuleInfoGet 之類的內部訊息的，是個既有的慣例。
//
// ── 為什麼要兩個頻道 ──
// Content="BCEMsg" 是 WCE 的頻道。我們照著它送，對方的 WCE 就會把我們寫進
// character.FBC，在我們頭上畫一個「WCE + LCE 的版本號」—— 頂著別人的名義對外
// 宣傳，不是我們要的。但完全不送的話，LCE 使用者之間也就互相看不到，/versions
// 只剩 WCE 的人。
//
// 所以拆成兩條：
//   BCEMsg（WCE 的）  只收不送 → 看得到 WCE/FBC 的人，但他們看不到我們
//   LCEMsg（我們的）  收送都做 → LCE 使用者互相看得到
//
// WCE 的接收端寫的是 `if (data.Content === "BCEMsg")`（見其
// hiddenMessageHandler.ts），所以 LCEMsg 對它來說完全不存在 —— 這正是我們要的：
// 分享的是 LCE 的身分，不是冒充 WCE。
//
// 註：不送 BCEMsg 也照樣收得到 WCE 的人。WCE 有兩個自己會開口的時機：
//   ChatRoomSyncMemberJoin → 有人進房時主動對新人送一則定向 Hello
//   ChatRoomSync           → 房間同步時廣播（成員進出都會觸發）
// 我們一進房，房裡的 WCE 使用者就會自動報上名來，不必先問。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';

const HIDDEN = 'Hidden';
const BCE_MSG = 'BCEMsg';   // WCE / FBC 的頻道 —— 只收不送
const LCE_MSG = 'LCEMsg';   // LCE 自己的頻道 —— 收送都做
const MSG_HELLO = 'Hello';

const inChatRoom = () =>
    typeof ServerIsConnected !== 'undefined' && ServerIsConnected
    && typeof ServerPlayerIsInChatRoom === 'function' && ServerPlayerIsInChatRoom();

/**
 * 在 LCE 自己的頻道上報上名號。
 * @param {number|null} target   指定對象的會員編號；null = 廣播給整個房間
 * @param {boolean} requestReply 要求對方也回報一次（進房時用，否則看不到既有的人）
 */
export function sendLceHello(target = null, requestReply = false) {
    if (!inChatRoom()) return;
    try {
        const payload = {
            type: MSG_HELLO,
            version: MOD_VER,
            replyRequested: requestReply,
        };
        // 版本一律送（/versions 要靠它才看得到 LCE 的人）；完整插件清單則看使用者願不願意
        if (getFeature('shareAddons')) {
            payload.otherAddons = window.bcModSdk?.getModsInfo?.() ?? [];
        }
        const message = {
            Type: HIDDEN,
            Content: LCE_MSG,
            Sender: Player.MemberNumber,
            Dictionary: [{ message: payload }],
        };
        if (target) message.Target = target;
        ServerSend('ChatRoomChat', message);
    } catch (e) {
        console.warn(LOG, 'sendLceHello 失敗:', e);
    }
}

/** Dictionary 可能是陣列或單一物件（WCE 兩種都收，我們照做）。 */
function parseMessage(data) {
    if (Array.isArray(data.Dictionary)) return data.Dictionary.find(t => t?.message)?.message || {};
    return data.Dictionary?.message || {};
}

/**
 * WCE/FBC 的人報到。
 * 註：WCE 的 processHello 在這裡還會處理 replyRequested 並回送一則 BCEMsg——
 * 我們刻意不回。在那個頻道上回覆就等於自稱 WCE。
 */
function processWceHello(sender, msg) {
    sender.FBC = msg.version ?? '0.0';
    sender.BCECapabilities = msg.capabilities ?? [];
    sender.FBCOtherAddons = msg.otherAddons;
}

/** LCE 的人報到。這是我們自己的頻道，該回就回。 */
function processLceHello(sender, msg) {
    sender.LCE = msg.version ?? '0.0';
    sender.LCEOtherAddons = msg.otherAddons;
    // 對方要求回報時只回他一個人，且不再要求回覆 —— 否則兩邊會無限互相打招呼。
    // 排除自己：伺服器會把自己送出的 ChatRoomChat 原封不動回傳一份，
    // 不擋的話每次廣播都會多送一則「回覆給自己」的訊息。
    if (msg.replyRequested && sender.MemberNumber !== Player?.MemberNumber) {
        sendLceHello(sender.MemberNumber, false);
    }
}

function onMessage(data) {
    if (data?.Type !== HIDDEN) return;
    if (data.Content !== BCE_MSG && data.Content !== LCE_MSG) return;
    try {
        const sender = Character.find(a => a.MemberNumber === data.Sender);
        if (!sender) return;
        const msg = parseMessage(data);
        if (msg.type !== MSG_HELLO) return;
        if (data.Content === BCE_MSG) processWceHello(sender, msg);
        else processLceHello(sender, msg);
    } catch (e) {
        console.warn(LOG, '處理 Hidden 打招呼訊息失敗:', e);
    }
}

let installed = false;

export function installHello() {
    if (installed) return;
    installed = true;

    const bind = () => {
        try {
            ServerSocket?.on('ChatRoomMessage', onMessage);
            // 有人進房 → 對他報名（不必要求回覆，他自己進房時會廣播）
            ServerSocket?.on('ChatRoomSyncMemberJoin', (data) => {
                if (data?.SourceMemberNumber !== Player.MemberNumber) sendLceHello(data.SourceMemberNumber, false);
            });
            // 自己進房 / 房間同步 → 廣播並要求既有的 LCE 使用者回報
            ServerSocket?.on('ChatRoomSync', () => sendLceHello(null, true));
        } catch { /* ignore */ }
    };

    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n <= 0) { console.warn(LOG, '找不到 ServerSocket，打招呼協定未啟用'); return; }
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        bind();
        try { modApi.hookFunction('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; }); }
        catch { /* ignore */ }
    })();
}
