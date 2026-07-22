// ════════════════════════════════════════════════════════════════════════════
// 打招呼協定 —— 與 WCE 同一條頻道（BCEMsg），靠夾帶標記區分 LCE / WCE
//
// BC 伺服器不提供「對方裝了什麼插件」的欄位，所以這類資訊得靠玩家之間自己用
// Type="Hidden" 的聊天訊息互報。Hidden 訊息不會顯示在聊天室裡（BC 的
// ChatRoomMessage 一看到 Type="Hidden" 就 return，連渲染都不進去），BC 自己也是
// 這樣傳 TakeSuitcase / RuleInfoGet 之類的內部訊息的，是個既有的慣例。
//
// ── 為什麼走 WCE 的頻道 ──
// LCE 是從 WCE 分流下來的，理應彼此看得到對方的版本/徽章。WCE 的接收端只認
// Content="BCEMsg"（見其 hiddenMessageHandler.ts 的 `if (data.Content === "BCEMsg")`），
// 所以要讓 WCE 使用者也查得到我們，就必須送 BCEMsg —— 這是唯一的路。
//
// 代價：WCE 收到 BCEMsg 後一律 `sender.FBC = version`，會在我們頭上畫「WCE vX」徽章、
// /versions 也列成 WCE。我們無法改 WCE 的顯示，這一點是刻意接受的取捨。
//
// ── 怎麼區分是 LCE 還是 WCE 送的 ──
// Hidden 訊息的 payload 是自由 JSON，可以夾任意欄位；WCE 的 processHello 只讀它認得的
// 幾個鍵，其餘一概忽略。所以我們在 BCEMsg 裡多夾一個 `lce`（= LCE 版本字串）當標記：
//   • WCE 端：看不懂 `lce`，照舊把我們當 WCE（版本用我們一起送的 `version`）。
//   • LCE 端：看到 `lce` → 認定這是 LCE 的招呼，寫進 character.LCE、畫 LCE 徽章，
//             不去動 character.FBC（所以純 LCE 使用者在彼此眼中只有 LCE 徽章，不會誤標 WCE）。
//   • 同時裝了 WCE + LCE 的人：WCE 送一則沒有 `lce` 的 BCEMsg（→ FBC），
//             LCE 送一則有 `lce` 的 BCEMsg（→ LCE），兩枚徽章各自成立。
//
// 相容性：舊版 LCE 走的是獨立的 LCEMsg 頻道，這裡仍保留「收」LCEMsg（見 onMessage），
// 讓還沒更新的 LCE 使用者依舊被認得；但我們自己只送 BCEMsg。
//
// 註：進房後不必先問，房裡的人（WCE 或 LCE）在 ChatRoomSync / MemberJoin 時都會自報，
// 我們自己進房也會廣播並要求既有的 LCE 使用者回報一次。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';

const HIDDEN = 'Hidden';
const BCE_MSG = 'BCEMsg';   // WCE 的頻道 —— 收送都做（送的訊息夾 lce 標記讓 LCE 端能區分）
const LCE_MSG = 'LCEMsg';   // 舊版 LCE 的獨立頻道 —— 只保留「收」以相容尚未更新的使用者
const MSG_HELLO = 'Hello';

const inChatRoom = () =>
    typeof ServerIsConnected !== 'undefined' && ServerIsConnected
    && typeof ServerPlayerIsInChatRoom === 'function' && ServerPlayerIsInChatRoom();

/**
 * 是否分享自己的完整插件清單。對齊 BC 原廠的 RespondRemoteModListQueries
 *（偏好 → 線上），取代舊的 LCE 專屬 shareAddons —— 單一開關管到底，與原廠
 * /mods remote 一致。設定未定義時視為分享（與原廠預設相同）。
 * 註：LCE 版本號一律照送（那是別人 /versions 看得到我們的唯一依據），這裡只管
 * 「要不要附上完整清單」。
 */
export function shouldShareAddons() {
    return typeof Player !== 'undefined' && Player?.OnlineSettings?.RespondRemoteModListQueries !== false;
}

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
            // version：WCE 端會讀這個並顯示「WCE vX」。一起送真實版本，WCE 使用者的 /versions
            //          才查得到我們的版本號（而不是 0.0）。
            version: MOD_VER,
            // lce：LCE 端專用的標記（WCE 忽略）。有它 = 這是 LCE 送的，LCE 端據此畫 LCE 徽章、
            //      不去動 character.FBC。值就放版本，省得再開一個欄位。
            lce: MOD_VER,
            replyRequested: requestReply,
        };
        // 能力宣告：讓對方知道我們支援哪些「需要雙方都裝才看得到」的功能（沿用 WCE 的
        // BCECapabilities 慣例，字串也對齊，才能與 WCE 使用者互通）。目前只有圖層隱藏，
        // 且只在該功能開啟時才宣告 —— 沒開就沒有 override 可呈現，也不該讓別人看到設定框。
        const caps = [];
        if (getFeature('layeringHide')) caps.push('layeringHide');
        if (caps.length) payload.capabilities = caps;
        // 完整插件清單看使用者願不願意分享；送出時 LCE 本身也在其中，
        // 於是 WCE 的 /versions 會把 LCE 列進「Other Addons」，等於在 WCE 那邊也認得出 LCE。
        if (shouldShareAddons()) {
            payload.otherAddons = window.bcModSdk?.getModsInfo?.() ?? [];
        }
        const message = {
            Type: HIDDEN,
            Content: BCE_MSG,   // 與 WCE 同頻道
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
 * WCE/FBC 的人報到（沒有 lce 標記的 BCEMsg）。
 * 註：這裡刻意不理 replyRequested。要讓 WCE 看到我們，靠的是自己在 ChatRoomSync 的廣播，
 * 每收到一則 WCE 招呼就回一則是多餘的（WCE 之間也只在自己人之間互回）。
 * LCE 之間的定向回覆由 processLceHello 處理。
 */
function processWceHello(sender, msg) {
    sender.FBC = msg.version ?? '0.0';
    sender.BCECapabilities = msg.capabilities ?? [];
    sender.FBCOtherAddons = msg.otherAddons;
}

/** LCE 的人報到。版本優先取 lce 標記（新版），退回 version（相容舊 LCEMsg）。 */
function processLceHello(sender, msg) {
    sender.LCE = (typeof msg.lce === 'string' ? msg.lce : null) ?? msg.version ?? '0.0';
    sender.LCEOtherAddons = msg.otherAddons;
    // 能力清單放進 BCECapabilities（與 WCE 同欄位）：圖層隱藏的設定框靠它判斷該不該顯示。
    sender.BCECapabilities = Array.isArray(msg.capabilities) ? msg.capabilities : [];
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
        // BCEMsg 同時承載 WCE 與 LCE 的招呼：夾了 lce 標記的是 LCE，其餘視為 WCE。
        // LCEMsg 是舊版 LCE 的獨立頻道，一律當 LCE。
        if (data.Content === LCE_MSG || (data.Content === BCE_MSG && msg.lce != null)) {
            processLceHello(sender, msg);
        } else {
            processWceHello(sender, msg);
        }
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
