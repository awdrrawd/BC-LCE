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

import { openDB } from 'idb';
import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { processChatAugmentsForLine } from './chat-augments.js';

const LOG = '🐈‍⬛ [LCE]';
const META = '';                     // BcUtil/WCE 的中繼資料標記
const BTN = [70, 905, 60, 60];             // 左下角（與 WCE 同位置）
const STYLE_ID = 'lce-im-style';
const DB_NAME = 'lce-im';
const DB_VER = 1;

const ONLINE_CLS = 'lce-friend-online';
const OFFLINE_CLS = 'lce-friend-offline';

let db = null;
let container, friendList, messageContainer, messageInput, friendSearch;
let activeChat = -1;
let unreadSinceOpened = 0;
let loaded = false;
const friendMessages = new Map();

const imOn = () => !!getFeature('instantMessenger');

/** 切掉 BcUtil/WCE 附在訊息尾端的中繼資料。 */
export function stripBeepMetadata(msg) {
    return String(msg ?? '').split(META)[0].trimEnd();
}

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'IM hook 未掛上:', name, e?.message ?? e); }
}

const parseJSON = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ───────────────────────────── UI ─────────────────────────────
function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#lce-im{display:flex;z-index:100;position:fixed;width:80%;height:70%;top:5%;left:10%;padding:0;margin:0;
  flex-direction:row;background-color:var(--lce-main,#111);color:var(--lce-text,#eee);
  border:0.2em solid var(--lce-accent,#fff);resize:both;overflow:auto;
  max-width:80%;max-height:75%;min-width:38%;min-height:30%;overflow-wrap:break-word;}
#lce-im.lce-hidden{display:none !important;}
#lce-im-left{display:flex;flex-direction:column;width:20%;height:100%;}
#lce-im-right{width:80%;display:flex;flex-direction:column;border-left:0.1em solid var(--lce-accent,#fff);}
#lce-friend-search{border:0;border-bottom:0.1em solid var(--lce-accent,#fff);padding:0.5em;height:1em;
  background-color:var(--lce-element,#222);color:var(--lce-text,#eee);}
#lce-friend-list{width:100%;overflow-x:hidden;overflow-y:scroll;}
.lce-friend-entry{padding:1em;cursor:pointer;}
.lce-friend-entry-name{font-weight:bold;display:flex;flex-direction:column;}
.lce-friend-selected{font-style:italic;border-top:0.1em solid var(--lce-accent,#fff);
  border-bottom:0.1em solid var(--lce-accent,#fff);background-color:var(--lce-element,#222);}
.lce-friend-unread{background-color:var(--lce-accent,#a22);}
.lce-friend-offline{text-decoration:line-through;color:var(--lce-text-disabled,gray);}
#lce-im-messages{width:100%;height:90%;font-size:1.5rem;font-family:Arial,sans-serif;}
#lce-im-input{width:100%;height:10%;border:0;padding:0;margin:0;
  background-color:var(--lce-element,#222);color:var(--lce-text,#eee);font-size:1.5rem;}
.lce-friend-history{overflow-y:scroll;overflow-x:hidden;height:100%;}
.lce-msg{padding:0.2em 0.4em;position:relative;white-space:pre-wrap;}
.lce-msg::before{content:attr(data-time);float:right;color:gray;font-size:0.5em;margin-right:0.2em;font-style:italic;}
.lce-msg-sender{text-shadow:0.05em 0.05em var(--lce-text,#eee);font-weight:bold;}
.lce-msg-Emote,.lce-msg-Action{font-style:italic;color:gray;}
.lce-msg-divider{margin:0.5em 2em;border-bottom:0.2em solid var(--lce-accent,#fff);}
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
async function openHistoryDB() {
    try {
        db = await openDB(DB_NAME, DB_VER, {
            upgrade(odb) { if (!odb.objectStoreNames.contains('history')) odb.createObjectStore('history'); },
        });
    } catch (e) { console.warn(LOG, 'IM 歷史資料庫開啟失敗:', e); }
}

const historyKey = () => `im-${Player?.AccountName?.toLowerCase() ?? 'anon'}`;

async function saveHistory() {
    if (!db) return;
    const history = {};
    friendMessages.forEach((friend, id) => {
        if (!friend.historyRaw.length) return;
        history[id] = { historyRaw: friend.historyRaw.slice(-100) };
    });
    try { await db.put('history', history, historyKey()); }
    catch (e) { console.warn(LOG, 'IM 歷史儲存失敗:', e); }
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

function addMessage(friendId, sent, beep, skipHistory, createdAt) {
    const friend = friendMessages.get(friendId);
    if (!friend || beep.BeepType) return;

    const details = parseJSON(String(beep.Message ?? '').split('\n').find(l => l.startsWith(META))?.substring(1) ?? '{}')
        ?? { messageType: 'Message' };
    const messageType = ['Message', 'Emote', 'Action'].includes(details.messageType) ? details.messageType : 'Message';
    const messageColor = details?.messageColor ?? '#ffffff';
    const messageText = String(beep.Message ?? '').split('\n').filter(l => !l.startsWith(META)).join('\n').trimEnd();
    if (!messageText) return;

    const scrolledToEnd = friend.history.scrollHeight - friend.history.scrollTop - friend.history.clientHeight < 1;
    const el = document.createElement('div');
    el.classList.add('lce-msg', sent ? 'lce-msg-sent' : 'lce-msg-received', `lce-msg-${messageType}`);
    el.setAttribute('data-time', createdAt.toLocaleString());

    const author = sent ? CharacterNickname(Player) : (beep.MemberName ?? '<?>');
    if (messageType === 'Emote') el.textContent = `*${author}${messageText}*`;
    else if (messageType === 'Action') el.textContent = `*${messageText}*`;
    else {
        const sender = document.createElement('span');
        sender.classList.add('lce-msg-sender');
        if (messageColor) sender.style.color = messageColor;
        sender.textContent = `${author}: `;
        el.append(sender, document.createTextNode(messageText));
    }

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
        if (container.classList.contains('lce-hidden')) unreadSinceOpened++;
    }

    processChatAugmentsForLine(el, scrolledToEnd ? scrollToBottom : () => null);
    friend.history.appendChild(el);
    if (scrolledToEnd) scrollToBottom();
    if (!skipHistory) saveHistory();
}

async function loadIM() {
    loaded = true;
    if (!db) return;
    let history = null;
    try { history = await db.get('history', historyKey()); } catch { /* ignore */ }
    for (const [idStr, fh] of Object.entries(history ?? {})) {
        const friendId = parseInt(idStr, 10);
        const friend = handleUnseenFriend(friendId);
        friend.historyRaw = fh.historyRaw;
        for (const h of fh.historyRaw) {
            addMessage(friendId, h.authorId === Player.MemberNumber, {
                Message: `${h.message}\n\n${META}${JSON.stringify({ messageType: h.type, messageColor: h.color })}`,
                MemberNumber: h.authorId,
                MemberName: h.author,
            }, true, h.createdAt ? new Date(h.createdAt) : new Date(0));
            if (h.createdAt) friend.listElement.setAttribute('data-last-updated', String(h.createdAt));
        }
    }
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
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    let text = messageInput.value;
    if (!text.trim()) return;
    messageInput.value = '';

    // /me、/action、*、** 的簡寫（同 WCE）
    let messageType = 'Message';
    if (text.startsWith('/me ')) { text = text.substring(4); if (!/^[', ]/u.test(text)) text = ` ${text}`; messageType = 'Emote'; }
    else if (text.startsWith('/action ')) { text = text.substring(8); messageType = 'Action'; }
    else if (/^\*[^*]/u.test(text)) { text = text.substring(1); if (!/^[', ]/u.test(text)) text = ` ${text}`; messageType = 'Emote'; }
    else if (text.startsWith('**')) { text = text.substring(2); messageType = 'Action'; }

    const message = {
        BeepType: '',
        MemberNumber: activeChat,
        IsSecret: true,
        Message: `${text}\n\n${META}${JSON.stringify({ messageType, messageColor: Player.LabelColor })}`,
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
    await openHistoryDB();

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
    const bind = () => { try { ServerSocket?.on('AccountQueryResult', onQueryResult); } catch { /* ignore */ } };
    bind();
    hook('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; });

    // 收件
    hook('ServerAccountBeep', 15, (args, next) => {
        const [beep] = args;
        if (beep && typeof beep === 'object' && !beep.BeepType && imOn()) {
            (async () => {
                if (!loaded) await loadIM();
                handleUnseenFriend(beep.MemberNumber);
                addMessage(beep.MemberNumber, false, beep, false, new Date());
            })();
        }
        return next(args);
    });

    // 送件（別的來源送的 beep 也記進來；自己送的已帶 META，不重複記）
    hook('ServerSend', 0, (args, next) => {
        const [command, beep] = args;
        if (command === 'AccountBeep' && beep && !beep.BeepType && typeof beep.Message === 'string' && !beep.Message.includes(META) && imOn()) {
            (async () => {
                if (!loaded) await loadIM();
                handleUnseenFriend(beep.MemberNumber);
                addMessage(beep.MemberNumber, true, beep, false, new Date());
            })();
        }
        return next(args);
    });

    // 左下角按鈕：有未讀變紅
    hook('DrawProcess', 10, (args, next) => {
        const ret = next(args);
        if (imOn()) {
            DrawButton(...BTN, '', unreadSinceOpened ? 'Red' : 'White', 'Icons/Small/Chat.png', T('im_title'), false);
        }
        return ret;
    });

    hook('CommonClick', 20, (args, next) => {
        if (imOn() && MouseIn(...BTN)) {
            if (!container.classList.contains('lce-hidden')) { hideIM(); return null; }
            (async () => {
                if (!loaded) await loadIM();
                sortIM();
                container.classList.remove('lce-hidden');
                ServerSend('AccountQuery', { Query: 'OnlineFriends' });
                unreadSinceOpened = 0;
                scrollToBottom();
                if (typeof NotificationReset === 'function') NotificationReset('Beep');
            })();
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
