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
import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { positionElement } from '../core/util.js';
import { lceChatNotify } from '../commands/commander.js';

const LOG = '🐈‍⬛ [LCE]';
const NOTE_ID = 'lceNoteInput';
const STYLE_ID = 'lce-notes-style';

// 與 WCE 一致（勿更動，否則資料不互通）
const DB_NAME = 'bce-past-profiles';
const DB_VER = 31;

const NOTES_BTN = [1520, 60, 90, 90];
const SAVE_BTN = [1720, 60, 90, 90];
const CANCEL_BTN = [1820, 60, 90, 90];

let db = null;
let noteInput = null;
let inNotes = false;
let noteUpdatedAt = 0;

const parseJSON = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const deepCopy = (o) => { try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); } };

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'pastProfiles hook 未掛上:', name, e?.message ?? e); }
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // z-index 必須壓過 BIO 的富文本檢視層，否則備註輸入框會被蓋住（WCE 也是這樣處理）
    s.textContent = `#${NOTE_ID}{z-index:100 !important;}\n.lce-hidden{display:none !important;}\n.lce-profile-open{margin-right:0.5em;user-select:none;}`;
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

    const lines = list.map(p => {
        const div = document.createElement('div');
        div.textContent = `${p.lastNick ? `${p.lastNick} / ${p.name}` : p.name} (${p.memberNumber}) — ${T('profiles_seen')}: ${new Date(p.seen).toLocaleDateString()}`;
        const link = document.createElement('a');
        link.textContent = T('profiles_open');
        link.href = '#';
        link.classList.add('lce-profile-open');
        link.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCharacter(p.memberNumber); });
        div.prepend(link);
        return div;
    });

    const footer = document.createElement('div');
    footer.textContent = T('profiles_footer')
        .replace('{num}', list.length.toLocaleString())
        .replace('{total}', matches.toLocaleString());

    lceChatNotify([header, ...lines, footer]);
}

// ───────────────────────── 備註 ─────────────────────────
const isNote = (n) => !!n && typeof n === 'object' && typeof n.note === 'string';

function showNoteInput() {
    if (!InformationSheetSelection?.MemberNumber || !noteInput) return;
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
    noteInput?.classList.add('lce-hidden');
    inNotes = false;
}

let installed = false;

export async function installPastProfiles() {
    if (installed) return;
    if (!getFeature('pastProfiles')) return;   // 同 WCE：關閉時整個功能不初始化（需重整才生效）
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
        return;
    }

    if (typeof ElementCreateTextArea === 'function') ElementCreateTextArea(NOTE_ID);
    noteInput = document.getElementById(NOTE_ID);
    if (noteInput) {
        noteInput.maxLength = 10000;
        noteInput.classList.add('lce-hidden');
    }

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
            const ctx = window.MainCanvas?.getContext('2d');
            if (ctx) {
                ctx.textAlign = 'left';
                DrawText(`${T('profiles_last_seen')} ${new Date(InformationSheetSelection.BCESeen).toLocaleString()}`, 1200, 75, 'grey', 'black');
                ctx.textAlign = 'center';
            }
        }
        return next(args);
    });

    // 角色載入時標記是否有備註
    hook('CharacterLoadOnline', 100, (args, next) => {
        const C = next(args);
        if (C && C.MemberNumber) {
            db.get('notes', C.MemberNumber).then(note => { C.FBCNoteExists = Boolean(isNote(note) && note.note); }).catch(() => {});
        }
        return C;
    });

    // 備註介面：優先權高於 BIO 編輯鈕，開啟備註時直接接管整個畫面
    hook('OnlineProfileRun', 20, (args, next) => {
        if (inNotes) {
            DrawText(T('notes_title'), 910, 105, 'Black', 'Gray');
            if (noteUpdatedAt) DrawText(`${T('notes_saved')} ${new Date(noteUpdatedAt).toLocaleString()}`, 60, 105, 'Black', 'Gray');
            positionElement(NOTE_ID, 36, 100, 160, 1790, 750);
            DrawButton(...SAVE_BTN, '', 'White', 'Icons/Accept.png', TextGet('LeaveSave'));
            DrawButton(...CANCEL_BTN, '', 'White', 'Icons/Cancel.png', TextGet('LeaveNoSave'));
            return null;   // 不呼叫 next：備註模式下不畫原本的個資頁
        }
        DrawButton(...NOTES_BTN, '', 'White', 'Icons/Notifications.png', T('notes_button'));
        return next(args);
    });

    hook('OnlineProfileClick', 20, (args, next) => {
        if (inNotes) {
            if (MouseIn(...SAVE_BTN)) {
                quotaSafetyCheck()
                    .then(() => db.put('notes', {
                        memberNumber: InformationSheetSelection.MemberNumber,
                        note: noteInput.value,
                        updatedAt: Date.now(),
                    }))
                    .catch(e => console.warn(LOG, '備註儲存失敗:', e));
                hideNoteInput();
            } else if (MouseIn(...CANCEL_BTN)) {
                hideNoteInput();
            }
            return null;
        }
        if (MouseIn(...NOTES_BTN)) { showNoteInput(); return null; }
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
