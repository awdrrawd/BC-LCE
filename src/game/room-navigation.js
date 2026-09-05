import { lceChatNotify } from '../ui/chat/notification.js';
const LOG = '🐈‍⬛ [LCE]';

/**
 * 無視限制切換/離開房間。
 *
 * 不走 WCE 的 ChatRoomJoinLeash + 搜尋那條路 —— 那條路會 race：
 * ChatSearchQuery 是 `await ServerRoomSearch(...)`，而 ServerRoomSearch 對「同一個查詢
 * 還在進行中」會直接回 ServerInProgressError，ChatSearchQuery 收到 err 就 return，
 * 於是 ChatSearchResultResponse 沒被呼叫 → ChatSearchAutoJoinRoom 沒跑 → leash 沒人理，
 * 人離開了房間卻停在搜尋頁。ChatSearchLoad 自己也會送查詢，所以撞不撞得到看運氣，
 * 這就是「有時候可以、有時候不行」的來源。
 *
 * 改用 BC 自己的加入機制 ServerRoomJoin()：直接送 ChatRoomJoin 並等 "JoinedRoom"，
 * 成功後伺服器的 ChatRoomSync 會自己把畫面切進房間。這正是 BC 重新登入時
 * 回到原房間用的流程（見 Server.js 的 ServerRoomJoin 呼叫處），與搜尋完全無關，
 * 房名大小寫也由伺服器比對。
 */

export function gotoRoom(roomName) {
    // 確保 BC 的 leash 自動加入不會插手
    if (typeof ChatRoomJoinLeash !== 'undefined') ChatRoomJoinLeash = '';
    if (typeof DialogLeave === 'function') DialogLeave();
    if (CurrentScreen === 'ChatRoom' && typeof ChatRoomLeave === 'function') ChatRoomLeave(false);

    // 我們是刻意要去別的地方，所以把「上一個房間」清掉：
    // 否則 ChatSearchAutoJoinRoom 的 ReturnToChatRoom 分支會搶著把你拉回剛離開的房間。
    if (typeof ChatRoomSetLastChatRoom === 'function') ChatRoomSetLastChatRoom(null);

    if (!roomName) {
        CommonSetScreen('Room', 'MainHall');
        return;
    }

    if (typeof ServerRoomJoin !== 'function') {
        lceChatNotify('此 BC 版本沒有 ServerRoomJoin，無法直接前往房間。');
        CommonSetScreen('Room', 'MainHall');
        return;
    }

    // 先落到大廳畫面再送加入請求：失敗時人就停在搜尋頁，跟 BC 重登的行為一致。
    Promise.resolve(CommonSetScreen('Online', 'ChatSearch'))
        .then(() => ServerRoomJoin(roomName))
        .then((ret) => {
            if (ret?.err) {
                console.warn(LOG, 'gotoroom 加入失敗:', ret.error);
                lceChatNotify(`無法加入房間 "${roomName}"：${ret.error?.message ?? ret.error?.name ?? '未知錯誤'}`);
            }
        })
        .catch(e => console.warn(LOG, 'gotoroom 失敗:', e));
}

/** Room links preserve their existing join semantics; command navigation owns its separate reset flow. */
export function joinRoom(name) {
    const clean = (name || '').trim();
    try {
        if (typeof ChatRoomLeave === 'function') ChatRoomLeave();
        if (typeof CommonSetScreen === 'function') CommonSetScreen('Online', 'ChatSearch');
        if (typeof ServerSend === 'function') ServerSend('ChatRoomJoin', { Name: clean });
    } catch (error) { console.warn(LOG, '加入房間失敗', error); }
}
