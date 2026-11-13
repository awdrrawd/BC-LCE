import { createSocketBinding } from '../../core/lifecycle.js';
// ════════════════════════════════════════════════════════════════════════════
// 好友上線 / 離線通知 —— 移植自 WCE friendPresenceNotifications.js
//
// 機制：每 20 秒送一次 AccountQuery(OnlineFriends)，用 socket 事件 AccountQueryResult
// 的結果與上一次比對，差集即為剛上線 / 剛離線的好友。
//
// 樣式（複合列的右側選項，二選一）：
//   bubble  = BC 內建的浮動提示（ToastManager，可點開好友列表）
//   message = 用 ChatRoomSendLocal 在聊天室輸出本地訊息 —— BCNotifyPlus 的做法
//   不在聊天室時 message 會自動退回 bubble（否則訊息無處可顯示）
//   兩者右側各有一顆音效開關，開啟時額外播 BC 的 beep 提示音
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../../modsdk.js';
import { getFeature } from '../../core/feature-settings.js';
import { isWceFeatureEnabled } from '../../core/wce-compat.js';
import { T } from '../../core/i18n.js';
import { LOCAL_MARKER } from '../chat/local-messages.js';
import { LOG } from '../../core/constants.js';


// 註：通知訊息的配色交給 features/local-messages.js 統一處理
// （所有 ChatRoomSendLocal 一律紫框黑字），這裡不再自己染色。
const POLL_MS = 20000;

// 這些畫面本來就有好友資訊 / 尚未連線，不查也不通知（同 WCE）
const SKIP_SCREENS = ['FriendList', 'Relog', 'Login'];

let stableFriends = null;
const pendingChanges = new Map();
let pollRound = 0;
const PRESENCE_CATEGORY = 'lce-friend-presence';

const onlineOn = () => !!getFeature('friendOnlineNotifyEnabled') && !isWceFeatureEnabled('friendPresenceNotifications');
const offlineOn = () => !!getFeature('friendOfflineNotifyEnabled')
    && !(isWceFeatureEnabled('friendPresenceNotifications') && isWceFeatureEnabled('friendOfflineNotifications'));
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
const LOCAL_MS  = 10000;

function showBubble(text) {
    if (typeof ToastManager !== 'undefined' && typeof ToastManager.info === 'function') {
        ToastManager.info(text, {
            category: PRESENCE_CATEGORY, duration: BUBBLE_MS, icon: '',
            onClick: () => { if (typeof FriendListShow === 'function') FriendListShow(); },
        });
        return true;
    }
    if (typeof ServerShowBeep !== 'function') return false;
    ServerShowBeep(text, BUBBLE_MS, {
        silent: true,
        onClick: () => { if (typeof FriendListShow === 'function') FriendListShow(); },
    });
    return true;
}

/**
 * 用 BC 的 ChatRoomSendLocal 送本地訊息（不外送，只有自己看得到）。
 * 訊息 div 是 BC 建的，我們碰不到，所以把標記包在內容裡讓樣式認得出來
 * （見 features/local-messages.js 的 :has 選擇器）。
 */
function showLocal(text, durationMs = LOCAL_MS) {
    if (typeof ChatRoomSendLocal !== 'function') return false;
    ChatRoomSendLocal(`<div class="${LOCAL_MARKER} lce-friend-notify">${esc(text)}</div>`, durationMs);
    return true;
}

/**
 * 依樣式送出通知。sound=true 時額外播提示音。
 * style: bubble = 只有氣泡／message = 只有聊天室訊息／both = 兩個都送。
 * 不在聊天室時 message 沒地方顯示，退回氣泡；both 則自然只剩氣泡。
 */
function notify(text, style, sound, durationSec = 5) {
    const inChatRoom = typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom';
    const wantLocal = (style === 'message' || style === 'both') && inChatRoom;
    const seconds = Math.max(0, Math.min(999, Number(durationSec) || 0));
    let sent = false;
    if (wantLocal) {
        try { sent = showLocal(text, seconds === 0 ? 0 : seconds * 1000); }
        catch (error) { console.warn(LOG, 'Friend presence local notification failed:', error); }
    }
    if (style === 'bubble' || style === 'both' || !sent) {
        try { sent = showBubble(text) || sent; }
        catch (error) { console.warn(LOG, 'Friend presence bubble notification failed:', error); }
    }
    if (sent && sound) playSound();
    return sent;
}

const fmt = (list) => list.map(({ MemberName, MemberNumber }) => `${MemberName} (${MemberNumber})`).join(', ');

// Only consecutive polling rounds confirm a change; extra replies cannot accelerate it.
function handleQueryResult(data) {
    if (!data || data.Query !== 'OnlineFriends' || !Array.isArray(data.Result)) return;
    const current = new Map(data.Result.map(({ MemberNumber, MemberName }) => [MemberNumber, { MemberNumber, MemberName }]));
    const online = onlineOn(), offline = offlineOn();
    if (!stableFriends) {
        stableFriends = current;
        pendingChanges.clear();
        return;
    }

    // Pausing notifications must not erase the last state reported to the user.
    if (skipScreen() || (!online && !offline)) { pendingChanges.clear(); return; }
    const came = [], went = [];
    for (const id of new Set([...stableFriends.keys(), ...current.keys(), ...pendingChanges.keys()])) {
        const present = current.has(id);
        if (present === stableFriends.has(id)) {
            pendingChanges.delete(id);
            if (present) stableFriends.set(id, current.get(id));
            continue;
        }
        const pending = pendingChanges.get(id);
        const enabled = present ? online : offline;
        if (!enabled) { pendingChanges.delete(id); continue; }
        if (!pending || pending.round !== pollRound - 1) {
            if (pending?.round !== pollRound) pendingChanges.set(id, { round: pollRound });
            continue;
        }
        const friend = present ? current.get(id) : stableFriends.get(id);
        (present ? came : went).push(friend);
    }

    for (const [friends, present, key] of [[came, true, 'friendOnlineNotify'], [went, false, 'friendOfflineNotify']]) {
        if (!friends.length) continue;
        const text = T(present ? 'friend_now_online' : 'friend_now_offline').replace('{list}', fmt(friends));
        if (!notify(text, getFeature(key), getFeature(key + 'Sound'), getFeature(key + 'Duration'))) continue;
        for (const friend of friends) {
            if (present) stableFriends.set(friend.MemberNumber, friend);
            else stableFriends.delete(friend.MemberNumber);
            pendingChanges.delete(friend.MemberNumber);
        }
    }
}

const socketBinding = createSocketBinding({ AccountQueryResult: handleQueryResult });
function bindListener() { pendingChanges.clear(); socketBinding.bind(typeof ServerSocket === 'undefined' ? null : ServerSocket); }

function poll() {
    if (!onlineOn() && !offlineOn()) return;
    // The interval owns the cadence; reply latency must not skip a polling tick.
    if (typeof ServerIsConnected === 'undefined' || !ServerIsConnected || ServerSocket?.connected === false) {
        pendingChanges.clear();
        return;
    }
    if (skipScreen()) return;
    if (typeof ServerSend !== 'function') return;
    pollRound++;
    for (const [id, pending] of pendingChanges) {
        if (pending.round < pollRound - 1) pendingChanges.delete(id);
    }
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
                try { bindListener(); } catch { /* ignore */ }
                return ret;
            });
        } catch (e) { console.warn(LOG, '好友通知：ServerInit hook 未掛上:', e?.message ?? e); }
    })();
}
