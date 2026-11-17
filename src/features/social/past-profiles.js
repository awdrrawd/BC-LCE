import { SETTING_CHANGED_EVENT, LOG } from '../../core/constants.js';
import { createHook } from '../../core/hooks.js';
import { parseJSON } from '../../core/serialization.js';
// ════════════════════════════════════════════════════════════════════════════
// 保存並瀏覽已知的個人資料（pastProfiles）—— 移植自 WCE pastProfiles.js
//
// 刻意沿用 WCE 完全相同的資料庫（bce-past-profiles v31）與 schema，
// 讓兩邊的資料互通：已裝過 WCE 的帳號直接讀得到既有紀錄，反之亦然。
//
// 內容：
//   • 進房時保存看到的每個角色（去掉不必要欄位以節省空間）
//   • /profiles <關鍵字> 列出並開啟已保存的個資
//   • 個資頁顯示「最後看到」時間
//   • 個人備註（只有自己看得到），存在同一個 DB 的 notes store
// ════════════════════════════════════════════════════════════════════════════

import { openDB } from 'idb';
import { createNoteState } from './note-state.js';
import { getFeature } from '../../core/feature-settings.js';
import { shouldLceHandle } from '../../core/wce-compat.js';
import { createPositionableButton, exposeButton, LCE_API } from '../../core/public-api.js';
import { T } from '../../core/i18n.js';
import { positionElement, deepCopy } from '../../core/util.js';
import { lceChatNotify } from '../../ui/chat/notification.js';
import { sendBudget } from '../../core/send-budget.js';
import {
    PROFILE_SHARE_PREFIX, buildShareMessages, chunkSizeFor, createShareAssembler,
} from './profile-share.js';

const NOTE_ID = 'lceNoteInput';
const STYLE_ID = 'lce-notes-style';

// 與 WCE 共用的固定相容版本。未經使用者明確指定，不得調高版本。
// 新功能若需要新增 store/index 或其他 schema 變更，必須先討論；
// 推送較高資料庫版本會使仍指定舊版本的其他插件遇到 VersionError。
// v31 沿用 WCE 刪除舊索引的 schema；不是新增個資或備註欄位。
const DB_NAME = 'bce-past-profiles';
const DB_VER = 31;

// 模組載入時即公開，與 pastProfiles 功能是否啟用無關。
// version 是指定的相容版本，不是現存資料庫版本或自動升版授權。
// 查詢此 API 不會開啟或建立資料庫。
LCE_API.profileDatabase = Object.freeze({ name: DB_NAME, version: DB_VER });

// ── WCE Profile Share（WPS）互通協定 ──
// 移植自 Liko - WPS 外掛：把個資切塊後用隱藏聊天訊息傳給房內其他人，對方能一鍵開啟並存下。
// 線路格式（前綴、i/n、base64 串接）必須與 WPS 外掛一致才能雙向互通，細節與接收端的安全限制
// 都在 profile-share.js。每塊大小只由送出端決定，接收端靠 i/n 重組，所以可依 BC 的單則訊息上限調整。
const shareAssembler = createShareAssembler();
let shareInFlight = false;   // 同一時間只送一份，避免連按「分享」把發送佇列塞滿

function higherProfileReceiverAvailable() {
    const fcm = window.Liko?.FCM;
    return fcm?.apiVersion >= 1 && typeof fcm.profiles?.share === 'function';
}

const {
    api: notesButtonApi,
    getPosition: getNotesButtonPosition,
    isHidden: isNotesButtonHidden,
    isVisualHidden: isNotesButtonVisualHidden,
} = createPositionableButton([1520, 60, 90, 90]);
const SAVE_BTN = [1720, 60, 90, 90];
const CANCEL_BTN = [1820, 60, 90, 90];

let db = null;
let noteInput = null;
let inNotes = false;
let noteUpdatedAt = 0;

async function getNote(memberNumber) {
    if (typeof memberNumber !== 'number' || !Number.isFinite(memberNumber)) {
        throw new TypeError('Liko.LCE.pastProfiles.get: memberNumber must be a finite number');
    }
    const note = await db.get('notes', memberNumber);
    return isNote(note) ? note : undefined;
}

// BC MainCanvas is already the drawing context, not a canvas element.
function drawTimestamp(text, x, y, color, background) {
    if (typeof MainCanvas === 'undefined' || !MainCanvas) return;
    const alignment = MainCanvas.textAlign;
    try {
        MainCanvas.textAlign = 'left';
        DrawText(text, x, y, color, background);
    } finally {
        MainCanvas.textAlign = alignment;
    }
}

async function setNote(memberNumber, note) {
    if (typeof memberNumber !== 'number' || !Number.isFinite(memberNumber)) {
        throw new TypeError('Liko.LCE.pastProfiles.set: memberNumber must be a finite number');
    }
    if (typeof note !== 'string') throw new TypeError('Liko.LCE.pastProfiles.set: note must be a string');
    await quotaSafetyCheck();
    const updatedAt = Date.now();
    await db.put('notes', { memberNumber, note, updatedAt });
    noteState.publish(memberNumber, Boolean(note));
    if (inNotes && InformationSheetSelection?.MemberNumber === memberNumber) {
        noteInput.value = note;
        noteUpdatedAt = updatedAt;
    }
}


const hook = createHook('past-profiles', () => shouldLceHandle('pastProfiles'));

const noteState = createNoteState({
    read: id => db.get('notes', id),
    ownsState: () => shouldLceHandle('pastProfiles'),
    characters: () => new Set([
        ...(typeof Character === 'undefined' ? [] : Character),
        ...(typeof ChatRoomCharacter === 'undefined' ? [] : ChatRoomCharacter),
        typeof InformationSheetSelection === 'undefined' ? null : InformationSheetSelection,
        typeof Player === 'undefined' ? null : Player,
    ]),
});
const refreshNoteFlag = c => noteState.refresh(c);
const refreshExistingNoteFlags = () => noteState.refreshAll();

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // z-index 必須壓過 BIO 的富文本檢視層，否則備註輸入框會被蓋住（WCE 也是這樣處理）
    s.textContent = `#${NOTE_ID}{z-index:100 !important;}\n.lce-hidden{display:none !important;}`
        + `\n.lce-profile-open,.lce-profile-share{margin-right:0.5em;user-select:none;cursor:pointer;}`
        + `\n.lce-share-open{user-select:none;cursor:pointer;font-weight:bold;}`;
    document.head.appendChild(s);
}

// ───────────────────────── 儲存空間 ─────────────────────────
async function readQuota() {
    try {
        const { quota, usage } = await navigator.storage.estimate();
        return { quota: quota ?? -1, usage: usage ?? 0 };
    } catch { return { quota: -1, usage: -1 }; }
}

/** 刪掉最久沒看到的 n 筆。 */
async function trimProfiles(n) {
    let list = await db.getAll('profiles');
    list.sort((a, b) => a.seen - b.seen);   // 最舊在前
    list = list.slice(0, n);
    const store = db.transaction('profiles', 'readwrite').objectStore('profiles');
    await Promise.all(list.map(p => store.delete(p.memberNumber)));
}

/** 用量超過 90% 就先清掉最舊的 10 筆（同 WCE）。 */
async function quotaSafetyCheck() {
    const { quota, usage } = await readQuota();
    if (quota > 0 && usage / quota > 0.9) {
        console.info(LOG, `個資儲存用量超過 90%（${usage}/${quota}），先清理最久未見的紀錄`);
        await trimProfiles(10);
    }
}

// 這些欄位不需要保存，去掉以節省空間（同 WCE）
const UNNEEDED = ['ActivePose', 'Inventory', 'BlockItems', 'LimitedItems', 'FavoriteItems',
    'ArousalSettings', 'OnlineSharedSettings', 'WhiteList', 'BlackList', 'Crafting'];

async function saveProfile(bundle) {
    if (!db) return;
    await quotaSafetyCheck();
    const name = bundle.Name;
    const nick = bundle.Nickname;
    for (const f of UNNEEDED) delete bundle[f];
    try {
        await db.put('profiles', {
            memberNumber: bundle.MemberNumber,
            name,
            lastNick: nick,
            seen: Date.now(),
            characterBundle: JSON.stringify(bundle),
        });
    } catch (e) {
        const { quota, usage } = await readQuota();
        console.warn(LOG, `個資保存失敗（${usage}/${quota}）:`, e);
    }
}

// ───────────────────────── 瀏覽 ─────────────────────────
async function openCharacter(memberNumber) {
    try {
        const profile = await db.get('profiles', memberNumber);
        const C = CharacterLoadOnline(parseJSON(profile.characterBundle), memberNumber);
        C.BCESeen = profile.seen;                       // 沿用 WCE 的欄位名
        if (CurrentScreen === 'ChatRoom') {
            ChatRoomHideElements();
            if (typeof ChatRoomData !== 'undefined' && ChatRoomData) ChatRoomBackground = ChatRoomData.Background;
        }
        InformationSheetLoadCharacter(C);
    } catch (e) {
        lceChatNotify(T('profiles_none'));
        console.warn(LOG, '讀取個資失敗:', e);
    }
}

async function listProfiles(filter) {
    if (!db) { lceChatNotify(T('profiles_none')); return; }
    let list = await db.getAll('profiles');
    list = list.filter(p => !filter
        || p.name.toLowerCase().includes(filter)
        || p.memberNumber.toString().includes(filter)
        || p.lastNick?.toLowerCase().includes(filter));
    list.sort((a, b) => b.seen - a.seen);
    const matches = list.length;
    list = list.slice(0, 100);
    list.sort((a, b) => -(b.lastNick ?? b.name).localeCompare(a.lastNick ?? a.name));

    const header = document.createElement('h3');
    header.textContent = T('profiles_title');
    header.style.marginTop = '0';
    header.classList.add('lce-collapse-keep');   // 收合時仍保留標題

    const lines = list.map(p => {
        const div = document.createElement('div');
        div.textContent = `${p.lastNick ? `${p.lastNick} / ${p.name}` : p.name} (${p.memberNumber}) — ${T('profiles_seen')}: ${new Date(p.seen).toLocaleDateString()}`;
        const link = document.createElement('a');
        link.textContent = T('profiles_open');
        link.href = '#';
        link.classList.add('lce-profile-open');
        link.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCharacter(p.memberNumber); });
        // 分享鈕：把這份個資傳給房內其他人（WPS 互通）。
        const share = document.createElement('a');
        share.textContent = T('profiles_share');
        share.href = '#';
        share.classList.add('lce-profile-share');
        share.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); shareProfile(p.memberNumber); });
        div.prepend(share);
        div.prepend(link);
        return div;
    });

    const footer = document.createElement('div');
    footer.textContent = T('profiles_footer')
        .replace('{num}', list.length.toLocaleString())
        .replace('{total}', matches.toLocaleString());
    footer.classList.add('lce-collapse-keep');   // 收合時仍保留「共 N 筆」統計

    // 清單通常很長，末端補收合 ▼／刪除 ✖，避免洗版。
    lceChatNotify([header, ...lines, footer], { closable: true, collapsible: true });
}

// ───────────────────── WCE Profile Share（WPS 互通）─────────────────────
// 移植自 Liko - WPS 外掛：/profiles 清單每列多一顆「分享」鈕，按下把該份個資切塊、
// 用隱藏聊天訊息送給房內每個人；對方收到後可一鍵開啟並存進自己的 DB。
// 線路格式與 WPS 完全一致，兩邊可雙向互通（LCE↔WPS）。

/** 分享來的個資只在比本地那份新時才覆蓋，避免用舊資料蓋掉新的。收到分享時就會呼叫（與 FCM 一致），開啟時也會再呼叫一次（無害）。 */
async function saveIfNewer(profile) {
    if (!db) return;
    try {
        const local = await db.get('profiles', profile.memberNumber);
        if (!local || profile.seen > local.seen) {
            await db.put('profiles', {
                memberNumber: profile.memberNumber,
                name: profile.name,
                lastNick: profile.lastNick,
                seen: profile.seen,
                characterBundle: profile.characterBundle,
            });
        }
    } catch (e) { console.warn(LOG, '存分享個資失敗:', e); }
}

/** 開啟一份分享來的個資（並存下）。 */
function openSharedCharacter(profile) {
    try {
        const C = CharacterLoadOnline(parseJSON(profile.characterBundle), profile.memberNumber);
        C.BCESeen = profile.seen;
        InformationSheetLoadCharacter(C);
        saveIfNewer(profile);
    } catch (e) {
        lceChatNotify(T('profiles_none'));
        console.warn(LOG, '開啟分享個資失敗:', e);
    }
}

const SHARE_PRIORITY = Object.freeze({ priority: 'high' });   // 使用者主動、總量有限：高於動畫，也不被表情的持續補送卡住
const SHARE_RETRY_MIN = 40;       // 發送額度不足時的最短重試間隔
const SHARE_STALL_MS = 10_000;    // 單塊等不到額度的上限，超過就放棄這次分享

const inRoom = () => (typeof ServerPlayerIsInChatRoom === 'function' ? ServerPlayerIsInChatRoom() : CurrentScreen === 'ChatRoom');

/**
 * 依序送出分塊，並與動畫共用同一份發送預算（高優先級）：額度不足就等，BC 發送佇列非空就讓路。
 * 不能一次把幾十塊全塞進佇列，否則聊天與動畫都得排在它們後面好幾秒。
 * 回傳是否全部送出；離開房間、發送失敗或等待過久則中止並回傳 false。
 */
function sendShareChunks(contents) {
    return new Promise(resolve => {
        let index = 0, waitStart = null;
        const step = () => {
            try {
                if (!inRoom()) return resolve(false);
                if (index >= contents.length) return resolve(true);
                if (!sendBudget.requestSlot(SHARE_PRIORITY)) {
                    const now = Date.now();
                    waitStart ??= now;
                    if (now - waitStart > SHARE_STALL_MS) return resolve(false);
                    return void setTimeout(step, Math.max(SHARE_RETRY_MIN, sendBudget.nextAllowedAt(SHARE_PRIORITY) - now));
                }
                waitStart = null;
                sendBudget.withOwnSend(() => ServerSend('ChatRoomChat', { Type: 'Hidden', Content: contents[index] }));
                sendBudget.markSubmitted();
                index++;
                setTimeout(step, sendBudget.config.minGap);
            } catch (e) { console.warn(LOG, '分享分塊送出失敗:', e); resolve(false); }
        };
        step();
    });
}

/** 把某會員的個資切塊後用隱藏訊息送給房內所有人。 */
async function shareProfile(memberNumber) {
    if (!db) { lceChatNotify(T('profiles_none')); return; }
    if (CurrentScreen !== 'ChatRoom' || typeof ServerSend !== 'function') {
        lceChatNotify(T('profiles_none')); return;   // 不在房間裡就沒有對象可分享
    }
    if (shareInFlight) { lceChatNotify(T('profiles_share_busy')); return false; }
    shareInFlight = true;
    try {
        const profile = await db.get('profiles', memberNumber);
        if (!profile) { lceChatNotify(T('profiles_none')); return; }

        const payload = {
            sharedAt: Date.now(),
            from: {
                memberNumber: Player?.MemberNumber,
                name: (typeof CharacterNickname === 'function' ? CharacterNickname(Player) : null)
                    || Player?.Nickname || Player?.Name || String(Player?.MemberNumber),
            },
            profile: {
                memberNumber: profile.memberNumber,
                name: profile.name,
                lastNick: profile.lastNick,
                seen: profile.seen,
                characterBundle: profile.characterBundle,
            },
        };

        const shareId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const built = buildShareMessages(payload, shareId, chunkSizeFor(globalThis.ServerChatMessageMaxLength));
        if (built.tooLarge) {
            lceChatNotify(T('profiles_share_too_large')
                .replace('{size}', String(Math.ceil(built.chars / 1000)))
                .replace('{max}', String(Math.floor(built.limit / 1000))));
            return false;
        }

        const displayName = profile.lastNick || profile.name || String(memberNumber);
        lceChatNotify(T('profiles_shared_self').replace('{name}', displayName).replace('{id}', String(memberNumber)));
        return await sendShareChunks(built.contents);
    } catch (e) { console.warn(LOG, '分享個資失敗:', e); }
    finally { shareInFlight = false; }
    return false;
}

/** 收到隱藏分塊訊息 → 組回完整 payload → 顯示可一鍵開啟的本地訊息。回傳是否為 WPS 訊息（不合格的也吞掉）。 */
function handleShareMessage(data) {
    if (typeof data?.Content !== 'string' || !data.Content.startsWith(PROFILE_SHARE_PREFIX)) return false;
    try {
        const result = shareAssembler.accept(data.Sender, data.Content);
        if (result.status === 'complete') {
            showReceivedShare(result.payload, data.Sender);
            // 收到就記錄（與 FCM 一致），不必等使用者點「開啟」；仍只在比本地新時才覆蓋。自己分享的不用再存。
            if (data.Sender !== Player?.MemberNumber) void saveIfNewer(result.payload.profile);
        }
    } catch (e) { console.warn(LOG, 'WPS 解析失敗:', e); }
    return true;
}

/** 顯示一則「某人分享了個資」的本地訊息，附上可點的開啟連結。sender 是伺服器附的送出者編號，不是 payload 自稱的。 */
function showReceivedShare({ profile: p, fromName }, sender) {
    if (sender === Player?.MemberNumber) return;   // 自己分享的不用再顯示一次

    const known = typeof ChatRoomCharacter !== 'undefined' ? ChatRoomCharacter.find(c => c.MemberNumber === sender) : null;
    const from = (known && typeof CharacterNickname === 'function' ? CharacterNickname(known) : null) || fromName || String(sender);
    const displayName = p.lastNick || p.name || p.memberNumber;
    const seen = new Date(p.seen).toLocaleDateString();

    const wrap = document.createElement('div');
    wrap.appendChild(document.createTextNode(`${T('profiles_shared_from').replace('{from}', from)}： `));
    const open = document.createElement('a');
    open.textContent = T('profiles_shared_open');
    open.href = '#';
    open.classList.add('lce-share-open');
    open.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSharedCharacter(p); });
    wrap.appendChild(open);
    wrap.appendChild(document.createTextNode(` ${displayName} (${p.memberNumber}) — ${T('profiles_seen')}: ${seen}`));
    lceChatNotify(wrap);
}

// ───────────────────────── 備註 ─────────────────────────
const isNote = (n) => !!n && typeof n === 'object' && typeof n.note === 'string';

function showNoteInput() {
    if (!InformationSheetSelection?.MemberNumber || !noteInput) return;
    if (typeof OnlineProfileSetMode === 'function') ElementWrap(OnlineProfile.IDs.screen)?.setAttribute('hidden', '');
    inNotes = true;
    noteInput.classList.remove('lce-hidden');
    noteInput.value = '…';
    db.get('notes', InformationSheetSelection.MemberNumber)
        .then(note => {
            noteInput.value = isNote(note) ? (note.note || '') : '';
            noteUpdatedAt = (isNote(note) && note.updatedAt) || 0;
        })
        .catch((e) => { noteInput.value = ''; console.warn(LOG, '讀取備註失敗:', e); });
}

function hideNoteInput() {
    if (inNotes && typeof OnlineProfileSetMode === 'function') ElementWrap(OnlineProfile.IDs.screen)?.removeAttribute('hidden');
    noteInput?.classList.add('lce-hidden');
    inNotes = false;
}

let installed = false;
let watchingSettings = false;

export async function installPastProfiles() {
    if (!watchingSettings) {
        watchingSettings = true;
        window.addEventListener(SETTING_CHANGED_EVENT, event => {
            if (event.detail?.key !== 'pastProfiles') return;
            if (event.detail.value) void installPastProfiles().catch(error => console.warn(LOG, '個資初始化失敗:', error));
            else hideNoteInput();
        });
    }
    if (installed) {
        if (db) refreshExistingNoteFlags();
        return;
    }
    if (!getFeature('pastProfiles')) return;
    installed = true;
    injectStyle();

    try {
        db = await openDB(DB_NAME, DB_VER, {
            upgrade(odb, ov, nv, tx) {
                if (!odb.objectStoreNames.contains('profiles')) odb.createObjectStore('profiles', { keyPath: 'memberNumber' });
                for (const idx of tx.objectStore('profiles').indexNames) tx.objectStore('profiles').deleteIndex(idx);
                if (!odb.objectStoreNames.contains('notes')) odb.createObjectStore('notes', { keyPath: 'memberNumber' });
                for (const idx of tx.objectStore('notes').indexNames) tx.objectStore('notes').deleteIndex(idx);
            },
        });
    } catch (e) {
        console.warn(LOG, '個資資料庫開啟失敗，功能停用:', e);
        installed = false;
        return;
    }

    exposeButton('pastProfiles', { ...notesButtonApi, isEnabled: () => shouldLceHandle('pastProfiles') });
    LCE_API.pastProfiles = { get: getNote, set: setNote };
    LCE_API.ProfileShare = Object.freeze({
        apiVersion: 1,
        share: shareProfile,
        handlesReceive: () => !higherProfileReceiverAvailable(),
    });

    if (typeof ElementCreateTextArea === 'function') ElementCreateTextArea(NOTE_ID);
    noteInput = document.getElementById(NOTE_ID);
    if (noteInput) {
        noteInput.maxLength = 10000;
        noteInput.classList.add('lce-hidden');
    }

    // 收取 PROFILESHARE 分享：攔截帶有協定前綴的隱藏分塊訊息並自行處理。
    hook('ChatRoomMessage', 0, (args, next) => {
        const [data] = args;
        if (higherProfileReceiverAvailable()) return next(args);
        if (data?.Type === 'Hidden' && handleShareMessage(data)) return undefined;
        return next(args);
    });

    // 進房 / 單人同步時保存個資
    hook('ChatRoomSync', 100, (args, next) => {
        const [data] = args;
        if (data?.Character?.length) for (const char of data.Character) saveProfile(deepCopy(char));
        return next(args);
    });
    hook('ChatRoomSyncSingle', 100, (args, next) => {
        const [data] = args;
        if (data?.Character?.MemberNumber) saveProfile(deepCopy(data.Character));
        return next(args);
    });

    // 個資頁顯示「最後看到」
    hook('InformationSheetRun', 10, (args, next) => {
        if (InformationSheetSelection?.BCESeen) {
            drawTimestamp(`${T('profiles_last_seen')} ${new Date(InformationSheetSelection.BCESeen).toLocaleString()}`, 1200, 75, 'grey', 'black');
        }
        return next(args);
    });

    // 角色載入時標記是否有備註
    hook('CharacterLoadOnline', 100, (args, next) => {
        const C = next(args);
        refreshNoteFlag(C);
        return C;
    });
    // Login can populate the room before the asynchronous database open completes.
    // The load hook only sees future characters, so also hydrate existing instances.
    refreshExistingNoteFlags();

    // 備註介面：優先權高於 BIO 編輯鈕，開啟備註時直接接管整個畫面
    if (typeof OnlineProfileSetMode === 'function') {
        hook('OnlineProfileLoad', 20, async (args, next) => {
            const result = await next(args);
            const cancel = ElementWrap(OnlineProfile.IDs.cancelButton);
            if (cancel && !isNotesButtonHidden() && !isNotesButtonVisualHidden()) {
                cancel.after(ElementButton.Create('lce-profile-notes', showNoteInput, {
                    image: 'Icons/Notifications.png', tooltip: T('notes_button'),
                }));
            }
            return result;
        });
    }
    hook('OnlineProfileRun', 20, (args, next) => {
        if (inNotes) {
            DrawText(T('notes_title'), 910, 105, 'Black', 'Gray');
            if (noteUpdatedAt) drawTimestamp(`${T('notes_saved')} ${new Date(noteUpdatedAt).toLocaleString()}`, 100, 105, 'Black', 'Gray');
            positionElement(NOTE_ID, 36, 100, 160, 1790, 750);
            DrawButton(...SAVE_BTN, '', 'White', 'Icons/Accept.png', TextGet('LeaveSave'));
            DrawButton(...CANCEL_BTN, '', 'White', 'Icons/Cancel.png', TextGet('LeaveNoSave'));
            return null;   // 不呼叫 next：備註模式下不畫原本的個資頁
        }
        if (typeof OnlineProfileSetMode !== 'function' && !isNotesButtonHidden() && !isNotesButtonVisualHidden()) {
            DrawButton(...getNotesButtonPosition(), '', 'White', 'Icons/Notifications.png', T('notes_button'));
        }
        return next(args);
    });

    hook('OnlineProfileClick', 20, (args, next) => {
        if (inNotes) {
            if (MouseIn(...SAVE_BTN)) {
                setNote(InformationSheetSelection.MemberNumber, noteInput.value)
                    .catch(e => console.warn(LOG, '備註儲存失敗:', e));
                hideNoteInput();
            } else if (MouseIn(...CANCEL_BTN)) {
                hideNoteInput();
            }
            return null;
        }
        if (typeof OnlineProfileSetMode !== 'function' && !isNotesButtonHidden() && MouseIn(...getNotesButtonPosition())) { showNoteInput(); return null; }
        return next(args);
    });

    hook('OnlineProfileExit', 20, (args, next) => { hideNoteInput(); return next(args); });

    // Esc 關閉備註
    const keyHandler = (e) => {
        if (e.key === 'Escape' && inNotes) { hideNoteInput(); e.stopPropagation(); e.preventDefault(); }
    };
    document.addEventListener('keydown', keyHandler, true);

    // /profiles
    try {
        if (typeof CommandCombine === 'function') {
            CommandCombine([{
                Tag: 'profiles',
                Description: T('profiles_cmd_desc'),
                Action: (_, command) => {
                    const filter = String(command ?? '').replace(/^\s*\/?\S+\s*/, '').trim().toLowerCase();
                    listProfiles(filter);
                },
            }]);
        }
    } catch (e) { console.warn(LOG, '/profiles 註冊失敗:', e); }

    // 盡量讓瀏覽器把這個 DB 標記為持久化，避免被自動清掉
    try {
        if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
            if (!(await navigator.storage.persist())) console.info(LOG, '個資儲存可能不是持久化的（瀏覽器未授予）。');
        }
    } catch { /* ignore */ }
}
