// ════════════════════════════════════════════════════════════════════════════
// 好友上線 / 離線通知 —— 移植自 WCE friendPresenceNotifications.js
//
// 機制：每 20 秒送一次 AccountQuery(OnlineFriends)，用 socket 事件 AccountQueryResult
// 的結果與上一次比對，差集即為剛上線 / 剛離線的好友。
//
// 樣式（複合列的右側選項，二選一）：
//   bubble  = BC 內建的浮動提示（ServerShowBeep，可點開好友列表）—— WCE 的做法
//   message = 用 ChatRoomSendLocal 在聊天室輸出本地訊息 —— BCNotifyPlus 的做法
//   不在聊天室時 message 會自動退回 bubble（否則訊息無處可顯示）
//   兩者右側各有一顆音效開關，開啟時額外播 BC 的 beep 提示音
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { LOCAL_MARKER } from './local-messages.js';

const LOG = '🐈‍⬛ [LCE]';

// 註：通知訊息的配色交給 features/local-messages.js 統一處理
// （所有 ChatRoomSendLocal 一律紫框黑字），這裡不再自己染色。
const POLL_MS = 20000;

// 這些畫面本來就有好友資訊 / 尚未連線，不查也不通知（同 WCE）
const SKIP_SCREENS = ['FriendList', 'Relog', 'Login'];

let lastFriends = [];
let listenerBound = false;

const onlineOn = () => !!getFeature('friendOnlineNotifyEnabled');
const offlineOn = () => !!getFeature('friendOfflineNotifyEnabled');
const skipScreen = () => typeof CurrentScreen === 'undefined' || SKIP_SCREENS.includes(CurrentScreen);

/** HTML 逸出：名稱是使用者可控的，直接塞進 ChatRoomSendLocal 會被當成標記解析。 */
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 播放提示音（BC 收到 beep 時用的同一顆）。 */
function playSound() {
    try {
        if (typeof AudioPlayInstantSound === 'function') AudioPlayInstantSound('Audio/BeepAlarm.mp3');
    } catch { /* ignore */ }
}

const BUBBLE_MS = 5000;
const LOCAL_MS  = 10000;   // 聊天室訊息留久一點：氣泡會自己飄走，訊息是要讓人回頭看的

function showBubble(text) {
    if (typeof ServerShowBeep !== 'function') return;
    ServerShowBeep(text, BUBBLE_MS, {
        silent: true,
        onClick: () => { if (typeof FriendListShow === 'function') FriendListShow(); },
    });
}

/**
 * 用 BC 的 ChatRoomSendLocal 送本地訊息（不外送，只有自己看得到）。
 * 訊息 div 是 BC 建的，我們碰不到，所以把標記包在內容裡讓樣式認得出來
 * （見 features/local-messages.js 的 :has 選擇器）。
 */
function showLocal(text) {
    if (typeof ChatRoomSendLocal !== 'function') return false;
    ChatRoomSendLocal(`<div class="${LOCAL_MARKER} lce-friend-notify">${esc(text)}</div>`, LOCAL_MS);
    return true;
}

/**
 * 依樣式送出通知。sound=true 時額外播提示音。
 * style: bubble = 只有氣泡／message = 只有聊天室訊息／both = 兩個都送。
 * 不在聊天室時 message 沒地方顯示，退回氣泡；both 則自然只剩氣泡。
 */
function notify(text, style, sound) {
    if (sound) playSound();
    const inChatRoom = typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom';
    const wantLocal = (style === 'message' || style === 'both') && inChatRoom;
    const sentLocal = wantLocal ? showLocal(text) : false;
    if (style === 'bubble' || style === 'both' || !sentLocal) showBubble(text);
}

const fmt = (list) => list.map(({ MemberName, MemberNumber }) => `${MemberName} (${MemberNumber})`).join(', ');

/** 比對前後兩次的線上好友清單並發通知。 */
function handleQueryResult(data) {
    if (skipScreen()) return;
    if (!data || data.Query !== 'OnlineFriends' || !Array.isArray(data.Result)) return;
    if (!onlineOn() && !offlineOn()) { lastFriends = data.Result; return; }

    const nowNumbers = data.Result.map(f => f.MemberNumber);
    const lastNumbers = lastFriends.map(f => f.MemberNumber);

    if (onlineOn()) {
        const came = data.Result.filter(f => !lastNumbers.includes(f.MemberNumber));
        if (came.length) notify(T('friend_now_online').replace('{list}', fmt(came)), getFeature('friendOnlineNotify'), getFeature('friendOnlineNotifySound'));
    }
    if (offlineOn()) {
        const went = lastFriends.filter(f => !nowNumbers.includes(f.MemberNumber));
        if (went.length) notify(T('friend_now_offline').replace('{list}', fmt(went)), getFeature('friendOfflineNotify'), getFeature('friendOfflineNotifySound'));
    }

    lastFriends = data.Result;
}

function bindListener() {
    if (typeof ServerSocket === 'undefined' || !ServerSocket) return;
    ServerSocket.on('AccountQueryResult', handleQueryResult);
    listenerBound = true;
}

function poll() {
    if (!onlineOn() && !offlineOn()) return;
    if (skipScreen()) return;
    if (typeof ServerSend !== 'function') return;
    ServerSend('AccountQuery', { Query: 'OnlineFriends' });
}

let installed = false;

export function installFriendPresence() {
    if (installed) return;
    installed = true;

    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket || typeof ServerIsConnected === 'undefined') {
            if (n <= 0) { console.warn(LOG, '好友通知：等待連線逾時'); return; }
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        bindListener();
        setInterval(() => { try { poll(); } catch (e) { console.warn(LOG, e); } }, POLL_MS);

        // 重連後 socket 監聽會失效，ServerInit 時重新掛回去（同 WCE 的做法）
        try {
            modApi.hookFunction('ServerInit', 10, (args, next) => {
                const ret = next(args);
                try { listenerBound = false; bindListener(); } catch { /* ignore */ }
                return ret;
            });
        } catch (e) { console.warn(LOG, '好友通知：ServerInit hook 未掛上:', e?.message ?? e); }
    })();
}
