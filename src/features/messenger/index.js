import { createHistoryRepository } from './history.js';
import { createSocketBinding } from '../../core/lifecycle.js';
import { createHook } from '../../core/hooks.js';
import { META, stripBeepMetadata, decodeMessage, encodeMessage, composeMessage } from './codec.js';
export { stripBeepMetadata } from './codec.js';
// ════════════════════════════════════════════════════════════════════════════
// 即時通訊（instantMessenger）—— 移植自 WCE instantMessenger.js
//
//   • 左下角一顆聊天鈕（Icons/Small/Chat.png），有未讀時變紅
//   • 點開後是自己的 UI：左側好友清單（含線上狀態/未讀標記/搜尋）＋ 右側訊息與輸入框
//   • 瀏覽器提示沿用 BC 的 NotificationRaise("Beep")（不在當前頁面時會跳）
//
// 與 BcUtil / WCE 互通：訊息尾端用  附上一行 JSON 中繼資料（訊息型別與顏色），
// 顯示時必須切掉，否則會像原本那樣把 {"messageType":...} 整串印出來。
//
// 歷史紀錄存 IndexedDB（不用 localStorage —— 那是全網域共用的空間，很容易被塞爆）。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../../core/feature-settings.js';
import { shouldLceHandle } from '../../core/wce-compat.js';
import { createPositionableButton, exposeButton } from '../../core/public-api.js';
import { T } from '../../core/i18n.js';
import { processChatAugmentsForLine } from '../chat/chat-augments.js';

const LOG = '🐈‍⬛ [LCE]';
const DEFAULT_Z_INDEX = 10;
const {
    api: messengerButtonApi,
    getPosition: getButtonPosition,
    isHidden: isButtonHidden,
    isVisualHidden: isButtonVisualHidden,
} = createPositionableButton([70, 905, 60, 60]);
const STYLE_ID = 'lce-im-style';

const ONLINE_CLS = 'lce-friend-online';
const OFFLINE_CLS = 'lce-friend-offline';

let container, friendList, messageContainer, messageInput, friendSearch;
let activeChat = -1;
let unreadSinceOpened = 0;
const friendMessages = new Map();

const imOn = () => shouldLceHandle('instantMessenger');

const hook = createHook('instant-messenger');


// ───────────────────────────── UI ─────────────────────────────
function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
/* 貼齊左上角、滿寬。z-index 10 是為了蓋過chat-room-top-menu */
#lce-im{display:flex;z-index:10;position:fixed;width:100%;height:70%;top:0;left:0;padding:0;margin:0;
  flex-direction:row;background-color:var(--lce-main,#242424);color:var(--lce-text,#eee);
  border:0.2em solid var(--lce-accent,#c3c3c3);resize:both;overflow:auto;
  max-width:100%;max-height:75%;min-width:38%;min-height:30%;overflow-wrap:break-word;box-sizing:border-box;}
#lce-im.lce-hidden{display:none !important;}
#lce-im-left{display:flex;flex-direction:column;width:20%;height:100%;}
#lce-im-right{width:80%;display:flex;flex-direction:column;border-left:0.1em solid var(--lce-accent,#c3c3c3);}
#lce-friend-search{border:0;border-bottom:0.1em solid var(--lce-accent,#c3c3c3);padding:0.5em;height:1em;
  background-color:var(--lce-element,#1a1a1a);color:var(--lce-text,#eee);}
#lce-friend-list{width:100%;overflow-x:hidden;overflow-y:scroll;}
.lce-friend-entry{padding:1em;cursor:pointer;}
.lce-friend-entry-name{font-weight:bold;display:flex;flex-direction:column;}
.lce-friend-selected{font-style:italic;border-top:0.1em solid var(--lce-accent,#c3c3c3);
  border-bottom:0.1em solid var(--lce-accent,#c3c3c3);background-color:var(--lce-element,#1a1a1a);}
/* 未讀通知刻意用寫死的紅色，不吃 --lce-accent —— 主題染色會把 accent 染成紫色，
   讓「有新訊息」這個提示看起來像一般選中狀態。訊息通知要一眼認得出來，不該被主題蓋過。 */
.lce-friend-unread{background-color:#c62828 !important;}
.lce-friend-offline{text-decoration:line-through;color:var(--lce-text-disabled,gray);}
#lce-im-messages{width:100%;height:90%;font-size:1.5rem;font-family:Arial,sans-serif;}
#lce-im-input{width:100%;height:10%;border:0;padding:0;margin:0;
  background-color:var(--lce-element,#1a1a1a);color:var(--lce-text,#eee);font-size:1.5rem;}
.lce-friend-history{overflow-y:scroll;overflow-x:hidden;height:100%;}
.lce-msg{padding:0.2em 0.4em;position:relative;white-space:pre-wrap;}
.lce-msg::before{content:attr(data-time);float:right;color:gray;font-size:0.5em;margin-right:0.2em;font-style:italic;}
.lce-msg-sender{text-shadow:0.05em 0.05em var(--lce-text,#eee);font-weight:bold;vertical-align:top;}
/* 只有圖片的訊息：圖片是 inline 且 .lce-img-link 有 vertical-align:top，
   名字若留在基線就會被擠到整張圖的最下緣，看起來像沒有名字。
   讓名字自己佔一行，維持「玩家: 圖片」的閱讀順序。 */
.lce-msg:has(> .lce-img-link) > .lce-msg-sender{display:block;}
.lce-msg-Emote,.lce-msg-Action{font-style:italic;color:gray;}
.lce-msg-divider{margin:0.5em 2em;border-bottom:0.2em solid var(--lce-accent,#c3c3c3);}
/* 訊息裡的連結：預設瀏覽器藍太亮，改用與聊天記錄一致的深藍（見 chat-augments）。 */
#lce-im a{color:#003f91;cursor:pointer;}
#lce-im a:visited{color:#380091;}
/* 卷軸：不開染色時 #c3c3c3；染色開啟時吃 --lce-accent。 */
#lce-im ::-webkit-scrollbar{width:0.6em;height:0.6em;}
#lce-im ::-webkit-scrollbar-thumb{background:var(--lce-accent,#c3c3c3);border-radius:0.3em;}
#lce-im ::-webkit-scrollbar-track{background:transparent;}
#lce-im{scrollbar-color:var(--lce-accent,#c3c3c3) transparent;}
`;
    document.head.appendChild(s);
}

function buildDom() {
    container = document.createElement('div');
    container.id = 'lce-im';
    container.classList.add('lce-hidden');

    const left = document.createElement('div');
    left.id = 'lce-im-left';
    friendSearch = document.createElement('input');
    friendSearch.id = 'lce-friend-search';
    friendSearch.setAttribute('placeholder', T('im_search'));
    friendSearch.autocomplete = 'off';
    friendList = document.createElement('div');
    friendList.id = 'lce-friend-list';
    left.append(friendSearch, friendList);

    const right = document.createElement('div');
    right.id = 'lce-im-right';
    messageContainer = document.createElement('div');
    messageContainer.id = 'lce-im-messages';
    messageInput = document.createElement('textarea');
    messageInput.id = 'lce-im-input';
    messageInput.setAttribute('maxlength', '2000');
    right.append(messageContainer, messageInput);

    container.append(left, right);
    document.body.appendChild(container);

    // 避免 BC 的聊天室按鍵處理在 document 層被觸發
    messageInput.addEventListener('keydown', e => e.stopPropagation());
    friendSearch.addEventListener('keydown', e => e.stopPropagation());
    friendSearch.onkeyup = onSearch;
    messageInput.addEventListener('keydown', onInputKey);
}

// ───────────────────────────── 歷史（IndexedDB）─────────────────────────────
const historyRepository = createHistoryRepository(() => Player?.AccountName?.toLowerCase() ?? 'anon');
function saveHistory() {
    const history = {};
    friendMessages.forEach((friend, id) => {
        if (friend.historyRaw.length) history[id] = { historyRaw: friend.historyRaw.slice(-100) };
    });
    return historyRepository.save(history);
}

// ───────────────────────────── 訊息 ─────────────────────────────
function scrollToBottom() {
    const friend = friendMessages.get(activeChat);
    if (friend) friend.history.scrollTop = friend.history.scrollHeight;
}

function sortIM() {
    [...friendList.children].sort((a, b) => {
        const notA = !a.classList.contains(ONLINE_CLS);
        const notB = !b.classList.contains(ONLINE_CLS);
        if (notA === notB) {
            const au = parseInt(a.getAttribute('data-last-updated') ?? '0', 10) || 0;
            const bu = parseInt(b.getAttribute('data-last-updated') ?? '0', 10) || 0;
            return bu - au;
        }
        return notA ? 1 : -1;
    }).forEach(node => { friendList.removeChild(node); friendList.appendChild(node); });
}

function changeActiveChat(friendId) {
    const friend = friendMessages.get(friendId);
    messageInput.disabled = !friend?.online;
    messageContainer.innerHTML = '';
    for (const f of friendMessages.values()) f.listElement.classList.remove('lce-friend-selected');
    if (friend) {
        friend.listElement.classList.add('lce-friend-selected');
        friend.listElement.classList.remove('lce-friend-unread');
        messageContainer.appendChild(friend.history);
        friend.unread = 0;
    }
    const prev = friendMessages.get(activeChat);
    if (prev) prev.history.querySelector('.lce-msg-divider')?.remove();
    sortIM();
    activeChat = friendId;
    scrollToBottom();
}

function handleUnseenFriend(friendId) {
    let msgs = friendMessages.get(friendId);
    if (msgs) return msgs;

    const data = {
        statusText: document.createElement('span'),
        listElement: document.createElement('div'),
        historyRaw: [],
        history: document.createElement('div'),
        unread: 0,
        online: false,
    };
    data.listElement.id = `lce-friend-entry-${friendId}`;
    data.listElement.classList.add('lce-friend-entry');
    data.listElement.onclick = () => changeActiveChat(friendId);
    data.history.classList.add('lce-friend-history');

    const name = document.createElement('div');
    name.classList.add('lce-friend-entry-name');
    name.textContent = Player.FriendNames?.get(friendId) || '';
    const num = document.createElement('div');
    num.textContent = String(friendId);
    data.listElement.append(name, num, data.statusText);
    friendList.appendChild(data.listElement);

    friendMessages.set(friendId, data);
    return data;
}

// Renders one message only; unread state, persistence and scrolling belong to the controller.
function renderMessage({ messageText, messageType, messageColor, author, sent, createdAt }) {
    const el = document.createElement('div');
    el.classList.add('lce-msg', sent ? 'lce-msg-sent' : 'lce-msg-received', `lce-msg-${messageType}`);
    el.setAttribute('data-time', createdAt.toLocaleString());

    if (messageType === 'Emote') el.textContent = `*${author}${messageText}*`;
    else if (messageType === 'Action') el.textContent = `*${messageText}*`;
    else {
        const sender = document.createElement('span');
        sender.classList.add('lce-msg-sender');
        if (messageColor) sender.style.color = messageColor;
        sender.textContent = `${author}: `;
        el.append(sender, document.createTextNode(messageText));
    }

    return el;
}

function addMessage(friendId, sent, beep, skipHistory, createdAt) {
    const friend = friendMessages.get(friendId);
    if (!friend || beep.BeepType) return;

    const { messageText, messageType, messageColor } = decodeMessage(beep.Message);
    if (!messageText) return;

    // 收到對方傳來、且正開著這個對話時，一律捲到最新訊息（就算原本捲在上面讀歷史也拉回底部）。
    // 其餘情況（自己送出、正在讀別的對話、載入歷史）維持「只有原本就在底部才捲」的行為。
    const scrolledToEnd = (!sent && friendId === activeChat && !container.classList.contains('lce-hidden'))
        || friend.history.scrollHeight - friend.history.scrollTop - friend.history.clientHeight < 1;
    const author = sent ? CharacterNickname(Player) : (beep.MemberName ?? '<?>');
    const el = renderMessage({ messageText, messageType, messageColor, author, sent, createdAt });

    const authorId = sent ? Player.MemberNumber : beep.MemberNumber;
    if (!skipHistory) {
        friend.historyRaw.push({ author, authorId, message: messageText, type: messageType, color: messageColor, createdAt: Date.now() });
        friend.listElement.setAttribute('data-last-updated', Date.now().toString());
        if (friendId !== activeChat) { friend.listElement.classList.add('lce-friend-unread'); friend.unread++; }
        if (friend.unread === 1 && (container.classList.contains('lce-hidden') || friendId !== activeChat)) {
            const divider = document.createElement('div');
            divider.classList.add('lce-msg-divider');
            friend.history.appendChild(divider);
        }
        if (container.classList.contains('lce-hidden') && !isButtonHidden() && !isButtonVisualHidden()) unreadSinceOpened++;
    }

    processChatAugmentsForLine(el, scrolledToEnd ? scrollToBottom : () => null);
    friend.history.appendChild(el);
    if (scrolledToEnd) scrollToBottom();
    if (!skipHistory) saveHistory();
}

const loadIM = () => historyRepository.restore(history => {
    for (const [idStr, fh] of Object.entries(history ?? {})) {
        const friendId = Number(idStr);
        if (!Number.isFinite(friendId) || !Array.isArray(fh?.historyRaw)) continue;
        const friend = handleUnseenFriend(friendId);
        friend.historyRaw = fh.historyRaw.filter(h => h && typeof h.message === 'string');
        for (const h of friend.historyRaw) {
            addMessage(friendId, h.authorId === Player.MemberNumber, {
                Message: encodeMessage(h.message, h.type, h.color),
                MemberNumber: h.authorId,
                MemberName: h.author,
            }, true, h.createdAt ? new Date(h.createdAt) : new Date(0));
            if (h.createdAt) friend.listElement.setAttribute('data-last-updated', String(h.createdAt));
        }
    }
});

const pendingBeeps = [];
let flushingBeeps = null;
function flushPendingBeeps() {
    return flushingBeeps ??= (async () => {
        await loadIM();
        while (pendingBeeps.length) {
            const item = pendingBeeps[0];
            handleUnseenFriend(item.id);
            addMessage(item.id, item.sent, item.beep, false, item.createdAt);
            pendingBeeps.shift();
        }
    })().finally(() => { flushingBeeps = null; });
}
function enqueueBeep(id, sent, beep) {
    pendingBeeps.push({ id, sent, beep: structuredClone(beep), createdAt: new Date() });
    void flushPendingBeeps().catch(error => console.warn(LOG, 'IM 歷史尚未就緒，訊息保留等待重試:', error));
}

// ───────────────────────────── 互動 ─────────────────────────────
function onSearch() {
    const search = friendSearch.value.toLowerCase();
    for (const [friendId, friend] of friendMessages) {
        const name = Player.FriendNames?.get(friendId)?.toLowerCase();
        friend.listElement.classList.toggle('lce-hidden',
            search !== '' && !String(friendId).includes(search) && !name?.includes(search));
    }
    sortIM();
}

function onInputKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    let text = messageInput.value;
    if (!text.trim()) return;
    messageInput.value = '';

    const message = {
        BeepType: '',
        MemberNumber: activeChat,
        IsSecret: true,
        Message: composeMessage(text, Player.LabelColor),
    };
    addMessage(activeChat, true, message, false, new Date());
    FriendListBeepLog.push({ ...message, MemberName: Player.FriendNames?.get(activeChat) || '', Sent: true, Private: false, Time: new Date() });
    ServerSend('AccountBeep', message);
}

function hideIM() {
    container.classList.add('lce-hidden');
    messageInput.blur();
    friendSearch.blur();
}

let installed = false;

export async function installInstantMessenger() {
    if (installed) return;
    installed = true;
    injectStyle();
    buildDom();
    // Hooks are installed synchronously; history is awaited by the event queue.

    exposeButton('Messenger', {
        ...messengerButtonApi,
        isEnabled: imOn,
        getZIndex: () => {
            const zIndex = Number(container.style.zIndex || getComputedStyle(container).zIndex);
            return Number.isFinite(zIndex) ? zIndex : DEFAULT_Z_INDEX;
        },
        setZIndex: (zIndex) => {
            if (typeof zIndex !== 'number' || !Number.isFinite(zIndex)) {
                throw new TypeError('setZIndex: zIndex must be a finite number');
            }
            container.style.zIndex = String(zIndex);
        },
        resetZIndex: () => { container.style.zIndex = String(DEFAULT_Z_INDEX); },
    });

    // 好友線上狀態
    const onQueryResult = (data) => {
        if (!data || data.Query !== 'OnlineFriends' || !Array.isArray(data.Result) || !imOn()) return;
        for (const f of data.Result) {
            const e = handleUnseenFriend(f.MemberNumber);
            e.online = true;
            e.statusText.textContent = T('im_online');
            e.listElement.classList.remove(OFFLINE_CLS);
            e.listElement.classList.add(ONLINE_CLS);
        }
        for (const [id, e] of friendMessages) {
            if (data.Result.some(f => f.MemberNumber === id)) continue;
            e.online = false;
            e.statusText.textContent = T('im_offline');
            e.listElement.classList.remove(ONLINE_CLS);
            e.listElement.classList.add(OFFLINE_CLS);
        }
        messageInput.disabled = !data.Result.some(f => f.MemberNumber === activeChat);
    };
    const socketBinding = createSocketBinding({ AccountQueryResult: onQueryResult });
    const bind = () => socketBinding.bind(typeof ServerSocket === 'undefined' ? null : ServerSocket);
    bind();
    hook('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; });

    // 收件
    // 忽略「自己 beep 自己」：有些插件會送一則 beep 給自己當作通知，那不是聊天，
    // 收進即時通訊只會多一個跟自己的對話、還會亮未讀。這是聊天用途，直接濾掉。
    hook('ServerAccountBeep', 15, (args, next) => {
        const [beep] = args;
        if (beep && typeof beep === 'object' && !beep.BeepType && beep.MemberNumber !== Player?.MemberNumber && imOn()) {
            enqueueBeep(beep.MemberNumber, false, beep);
        }
        return next(args);
    });

    // 送件（別的來源送的 beep 也記進來；自己送的已帶 META，不重複記）
    hook('ServerSend', 0, (args, next) => {
        const [command, beep] = args;
        // 同上：別的插件送給自己的 beep 也不記進來（否則會變成「自己跟自己」的對話）。
        if (command === 'AccountBeep' && beep && !beep.BeepType && beep.MemberNumber !== Player?.MemberNumber && typeof beep.Message === 'string' && !beep.Message.includes(META) && imOn()) {
            enqueueBeep(beep.MemberNumber, true, beep);
        }
        return next(args);
    });

    // 左下角按鈕：有未讀變紅
    hook('DrawProcess', 10, (args, next) => {
        const ret = next(args);
        if (imOn() && !isButtonHidden() && !isButtonVisualHidden()) {
            DrawButton(...getButtonPosition(), '', unreadSinceOpened ? 'Red' : 'White', 'Icons/Small/Chat.png', T('im_title'), false);
        }
        return ret;
    });

    hook('CommonClick', 20, (args, next) => {
        if (imOn() && !isButtonHidden() && MouseIn(...getButtonPosition())) {
            if (!container.classList.contains('lce-hidden')) { hideIM(); return null; }
            (async () => {
                await flushPendingBeeps();
                sortIM();
                // 登入時瀏覽器常無視 autocomplete='off' 把帳號名塞進搜尋框（它是頁面上第一個
                // text input）。每次開啟時清空並重跑過濾，確保清單不被殘留關鍵字誤篩。
                friendSearch.value = '';
                onSearch();
                container.classList.remove('lce-hidden');
                ServerSend('AccountQuery', { Query: 'OnlineFriends' });
                unreadSinceOpened = 0;
                scrollToBottom();
                if (typeof NotificationReset === 'function') NotificationReset('Beep');
            })().catch(error => console.warn(LOG, 'IM 操作失敗:', error));
            return null;
        }
        return next(args);
    });

    // 瀏覽器提示（不在當前頁面時 BC 會跳）：把中繼資料切掉，否則會顯示成一串 JSON
    hook('NotificationRaise', 15, (args, next) => {
        if (args[0] === 'Beep' && args[1]?.body) args[1].body = stripBeepMetadata(args[1].body);
        return next(args);
    });

    document.addEventListener('keydown', (e) => {
        if (!imOn()) return;
        if (e.key === 'Escape' && !container.classList.contains('lce-hidden')) {
            hideIM(); e.stopPropagation(); e.preventDefault();
        }
    }, true);
}
