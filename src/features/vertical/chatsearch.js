// ════════════════════════════════════════════════════════════════════════════
// 直式房間清單（verticalChatSearch）—— 移植自 MPL 的 csXxx / cshXxx
//
//   cs*   ChatSelect：用全螢幕 HTML 取代 canvas 版的「房間類型選擇」。
//   csh*  ChatSearch：用全螢幕 HTML 取代 canvas 版的「房間搜尋」，雙欄卡片 +
//         左右滑動翻頁 + 房間詳情 bottom sheet。
//
// 兩者都不改 BC 的資料流：搜尋走 ChatSearchQuery()、加入房間一律點 BC 原生的
// join button，找不到才 fallback 到全域函式。BC 更新改了 DOM 也只是退回 fallback。
// ════════════════════════════════════════════════════════════════════════════

import { injectStyle, removeStyle } from '../../core/util.js';
import { BASE_URL } from '../../core/constants.js';
import { T } from '../../core/i18n.js';
import { forceCanvasStyle, clearCanvasStyle } from './common.js';
import { getRoomRelations } from './relations.js';

const LOG = '🐈‍⬛ [LCE]';
const CARD_MIN_H = 82;
const CARD_GAP = 5;
const HEADER_H = 52;
const FOOTER_H = 48;

const bcText = (k) => (typeof TextGet === 'function' ? (TextGet(k) || k) : k);

// ───────────────────────── 區域（Space）工具 ─────────────────────────
function playerHasMaleGender() {
    try {
        const genders = typeof Player?.GetGenders === 'function' ? Player.GetGenders() : [];
        return Array.isArray(genders) && genders.includes('M');
    } catch { return false; }
}

/** @returns {string} 目前搜尋空間（'X' = 混合、'' = 女性） */
function getCurrentSpace() {
    if (typeof ChatSearchGetSpace === 'function') return ChatSearchGetSpace();
    return typeof ChatSearchSpace !== 'undefined' ? ChatSearchSpace : 'X';
}

const getSpaceButtonIcon = () =>
    (playerHasMaleGender() || getCurrentSpace() === 'X')
        ? BASE_URL + 'Icons/Gender.png'
        : BASE_URL + 'Screens/Online/ChatSelect/Female.png';

function getSpaceButtonLabel() {
    if (playerHasMaleGender()) return T('v_csh_space_male');
    return getCurrentSpace() === 'X' ? T('v_csh_space_to_f') : T('v_csh_space_to_x');
}

const getToggleTargetSpace = () =>
    playerHasMaleGender() ? 'X' : (getCurrentSpace() === 'X' ? '' : 'X');

function applySpace(space, queryText = '') {
    try {
        if (typeof Player !== 'undefined' && Player?.ChatSearchSettings) Player.ChatSearchSettings.Space = space;
        if (typeof ChatSearchSpace !== 'undefined') window.ChatSearchSpace = space;
    } catch (e) { console.warn(LOG, '切換區域失敗:', e); }
    if (typeof ChatSearchQuery === 'function') ChatSearchQuery(queryText);
}

// ───────────────────────── ChatSelect ─────────────────────────
let csActive = false;
export const isCsActive = () => csActive;

export function csApply() {
    if (csActive) return;
    csActive = true;
    injectStyle('lce-v-cs', `
        html, body { overflow-x:hidden !important }
        #lce-cs-bg { position:fixed; inset:0; z-index:100; overflow:hidden; background:var(--lce-background, #111) }
        #lce-cs-bg-img {
            position:absolute; top:0; left:-50vw; width:200vw; height:100%;
            object-fit:cover; object-position:top left; pointer-events:none;
        }
        #lce-cs-overlay {
            position:absolute; inset:0; z-index:101;
            display:flex; flex-direction:column; align-items:center; justify-content:space-evenly;
            padding:28px 24px; box-sizing:border-box; background:rgba(0,0,0,0.40);
        }
        #lce-cs-exit {
            position:absolute; top:10px; right:10px; z-index:102;
            width:42px; height:42px; border-radius:8px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.28));
            background:rgba(0,0,0,0.60); cursor:pointer;
            display:flex; align-items:center; justify-content:center; padding:0;
        }
        #lce-cs-exit img { width:26px; height:26px; object-fit:contain }
        #lce-cs-exit:active { background:rgba(120,20,20,0.80) }
        .lce-cs-row { width:100%; max-width:480px; display:flex; flex-direction:column; align-items:stretch; gap:9px }
        .lce-cs-btn {
            width:100%; min-height:64px; border-radius:14px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.28));
            background:var(--lce-element, rgba(15,15,35,0.80));
            color:var(--lce-text, #fff); font-size:18px; font-weight:700; cursor:pointer;
            display:flex; align-items:center; justify-content:center; gap:14px;
            user-select:none; padding:0 20px; backdrop-filter:blur(4px);
        }
        .lce-cs-btn:active { background:var(--lce-main, rgba(80,50,200,0.65)) }
        .lce-cs-btn.disabled { opacity:0.35; pointer-events:none }
        .lce-cs-btn img { width:34px; height:34px; flex-shrink:0 }
        .lce-cs-desc {
            font-size:13px; line-height:1.5; color:var(--lce-text, rgba(230,220,255,0.78));
            opacity:0.85; text-align:center; user-select:none; padding:0 8px;
        }
    `);
    buildCsBg();
}

export function buildCsBg() {
    if (!csActive) return;
    document.getElementById('lce-cs-bg')?.remove();

    const bg = document.createElement('div');
    bg.id = 'lce-cs-bg';
    const bgImg = document.createElement('img');
    bgImg.id = 'lce-cs-bg-img';
    bgImg.alt = '';
    bgImg.src = BASE_URL + 'Backgrounds/BrickWall.jpg';
    bg.appendChild(bgImg);

    const ol = document.createElement('div');
    ol.id = 'lce-cs-overlay';

    const exitBtn = document.createElement('button');
    exitBtn.id = 'lce-cs-exit';
    exitBtn.setAttribute('aria-label', T('v_cs_exit_aria'));
    const exitImg = document.createElement('img');
    exitImg.src = BASE_URL + 'Icons/Exit.png';
    exitImg.onerror = () => { exitImg.style.display = 'none'; exitBtn.textContent = '✕'; };
    exitBtn.appendChild(exitImg);
    exitBtn.addEventListener('click', () => {
        if (typeof ChatSelectExit === 'function') ChatSelectExit();
        else if (typeof CommonSetScreen === 'function') CommonSetScreen('Room', 'MainHall');
    });
    ol.appendChild(exitBtn);

    // ok 的 fallback 一律給 true：BC 更新讓變數消失時寧可讓使用者點下去，
    // 由 ChatSelectStartSearch 自己決定能不能進，也不要無故鎖住選項。
    const options = [
        {
            icon: BASE_URL + 'Screens/Online/ChatSelect/Female.png',
            label: bcText('FemaleOnlyChat'), desc: bcText('FemaleOnlyChatDescription1'), space: '',
            ok: typeof ChatSelectAllowedInFemaleOnly !== 'undefined' ? ChatSelectAllowedInFemaleOnly : true,
        },
        {
            icon: BASE_URL + 'Icons/Gender.png',
            label: bcText('MixedChat'), desc: bcText('MixedChatDescription1'), space: 'X', ok: true,
        },
        {
            icon: BASE_URL + 'Screens/Online/ChatSelect/Male.png',
            label: bcText('MaleOnlyChat'), desc: bcText('MaleOnlyChatDescription1'), space: 'M',
            ok: typeof ChatSelectAllowedInMaleOnly !== 'undefined' ? ChatSelectAllowedInMaleOnly : true,
        },
    ];

    for (const opt of options) {
        const row = document.createElement('div');
        row.className = 'lce-cs-row';
        const btn = document.createElement('button');
        btn.className = 'lce-cs-btn' + (opt.ok ? '' : ' disabled');
        const img = document.createElement('img');
        img.src = opt.icon;
        img.onerror = () => { img.style.display = 'none'; };
        btn.append(img, document.createTextNode(opt.label));
        btn.addEventListener('click', () => {
            if (!opt.ok) return;
            if (typeof ChatSelectStartSearch === 'function') ChatSelectStartSearch(opt.space);
        });
        const desc = document.createElement('div');
        desc.className = 'lce-cs-desc';
        desc.textContent = opt.desc;
        row.append(btn, desc);
        ol.appendChild(row);
    }

    bg.appendChild(ol);
    document.body.appendChild(bg);
}

export function csRemove() {
    if (!csActive) return;
    csActive = false;
    removeStyle('lce-v-cs');
    document.getElementById('lce-cs-bg')?.remove();
}

// ───────────────────────── ChatSearch ─────────────────────────
let cshActive = false;
let cshSyncTimer = null;
let cshNeedSync = false;
let cshPage = 1;
let cshRoomsCache = [];
let cshAnimating = false;
let cshDrag = null;

export const isCshActive = () => cshActive;
export const cshMarkNeedSync = () => { if (cshActive) cshNeedSync = true; };

/** 收到伺服器新房間列表 → debounce 100ms 再重刷（BC 會連續呼叫多次 Run）。 */
export function cshSyncIfNeeded() {
    if (!cshActive || !cshNeedSync || cshSyncTimer) return;
    cshNeedSync = false;
    cshSyncTimer = setTimeout(() => {
        cshSyncTimer = null;
        if (cshActive) renderCshList(true);
    }, 100);
}

// 進入直式模式時要藏起來的 BC 原生 ChatSearch DOM
const CSH_BC_IDS = [
    'chat-search-room-header',
    'chat-search-body',
    'chat-search-room-grid',
    'chat-search-search-menu',
    'chat-search-filter-help-screen',
];

function getCshRoomsSource() {
    if (typeof ChatSearchGetRooms === 'function') {
        const rooms = ChatSearchGetRooms();
        return Array.isArray(rooms) ? rooms.slice() : [];
    }
    if (typeof ChatSearchResult !== 'undefined' && Array.isArray(ChatSearchResult)) return ChatSearchResult.slice();
    return [];
}

/** 依視窗高度算每頁幾張卡（雙欄）。 */
function calcCshPerPage() {
    const listH = window.innerHeight - HEADER_H - FOOTER_H - 24;
    return Math.max(1, Math.floor(listH / (CARD_MIN_H + CARD_GAP))) * 2;
}

function buildRoomTags(room) {
    const tags = [];
    if (room.Space !== undefined && typeof ChatSearchGetSpaceName === 'function') {
        tags.push(ChatSearchGetSpaceName(room.Space));
    }
    if (room.Language && typeof ChatSearchGetLanguageName === 'function') {
        tags.push(ChatSearchGetLanguageName(room.Language));
    }
    if (room.Game) tags.push(bcText(room.Game));
    if (room.MapType && room.MapType !== 'Never' && typeof ChatSearchGetRoomTypeName === 'function') {
        tags.push(ChatSearchGetRoomTypeName(room.MapType));
    }
    if (Array.isArray(room.BlockCategory)) {
        for (const b of room.BlockCategory) tags.push(T('v_csh_block_prefix') + bcText(b));
    }
    if (Array.isArray(room.Access)) {
        for (const a of room.Access) {
            if (a === 'All') continue;
            tags.push(T('v_csh_access_prefix') + bcText(a + 'Access'));
        }
    }
    return tags;
}

function refreshCshSpaceButton() {
    const btn = document.getElementById('lce-csh-space-btn');
    if (!btn) return;
    const img = btn.querySelector('img');
    if (img) img.src = getSpaceButtonIcon();
    btn.setAttribute('aria-label', getSpaceButtonLabel());
    btn.style.opacity = playerHasMaleGender() ? '0.85' : '1';
    btn.dataset.locked = playerHasMaleGender() ? 'true' : 'false';
}

/**
 * 用 id 關鍵字在 BC 原生 ChatSearch DOM 裡找按鈕。
 * 這是「能動但脆弱」的做法：BC 改了命名就會回 null，呼叫端一定要有 fallback。
 */
function findChatSearchButton(...keywords) {
    const candidates = document.querySelectorAll('#chat-search-room-header button, [id^="chat-search"] button');
    for (const btn of candidates) {
        const id = (btn.id || '').toLowerCase();
        if (keywords.some(k => id.includes(k))) return btn;
    }
    return null;
}

function cshStyles() {
    return `
        html, body { overflow-x:hidden !important }
        #lce-csh-shell {
            position:fixed; inset:0; z-index:50;
            display:flex; flex-direction:column;
            background:var(--lce-background, #0a0a14); overflow:hidden;
        }
        #lce-csh-header {
            flex-shrink:0; height:${HEADER_H}px;
            display:flex; align-items:center; gap:5px;
            padding:0 8px; box-sizing:border-box;
            background:var(--lce-element, #12121e);
            border-bottom:1px solid var(--lce-accent, rgba(255,255,255,0.10));
        }
        #lce-csh-search-wrap { flex:1; min-width:0; height:36px; display:flex; align-items:center; position:relative }
        #lce-csh-search-wrap input {
            flex:1; height:100%; box-sizing:border-box;
            background:var(--lce-element-hover, rgba(255,255,255,0.08));
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            border-radius:9px; color:var(--lce-text, #fff); font-size:13px;
            padding:0 30px 0 10px; outline:none;
        }
        #lce-csh-search-wrap input::placeholder { color:var(--lce-text, #fff); opacity:0.38 }
        #lce-csh-clear {
            position:absolute; right:6px; top:50%; transform:translateY(-50%);
            background:none; border:none; color:var(--lce-text, #fff); opacity:0.45;
            font-size:15px; cursor:pointer; padding:0; line-height:1; display:none;
        }
        #lce-csh-clear.visible { display:block }
        .lce-csh-hbtn {
            flex-shrink:0; width:44px; height:44px; border-radius:10px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            background:var(--lce-element-hover, rgba(255,255,255,0.07));
            color:var(--lce-text, #fff);
            display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0;
        }
        .lce-csh-hbtn img { width:26px; height:26px; object-fit:contain }
        .lce-csh-hbtn:active { background:var(--lce-element-active, rgba(255,255,255,0.18)) }
        .lce-csh-hbtn.create { border-color:var(--lce-main, rgba(120,80,220,0.60)); background:var(--lce-main, rgba(100,60,200,0.25)) }

        /* 列表：三頁式軌道（prev/curr/next），靠 translateX 翻頁 */
        #lce-csh-list { flex:1; overflow:hidden; position:relative; touch-action:none }
        #lce-csh-track { position:absolute; inset:0; will-change:transform }
        #lce-csh-track.animating { transition:transform 220ms ease }
        .lce-csh-page {
            position:absolute; top:0; width:100%; height:100%;
            display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
            gap:${CARD_GAP}px; padding:6px; box-sizing:border-box; align-content:start;
        }
        .lce-csh-page.prev { left:-100% }
        .lce-csh-page.curr { left:0 }
        .lce-csh-page.next { left:100% }

        .lce-csh-card {
            background:var(--lce-element, rgba(255,255,255,0.05));
            border:1px solid var(--lce-accent, rgba(255,255,255,0.10));
            border-radius:10px; padding:7px 8px; cursor:pointer;
            display:flex; flex-direction:column; gap:3px;
            min-height:${CARD_MIN_H}px; box-sizing:border-box; position:relative;
            min-width:0; overflow:hidden;
        }
        .lce-csh-card:active { background:var(--lce-element-hover, rgba(255,255,255,0.14)) }
        .lce-csh-card.full {
            border-color:rgba(255,70,70,0.88); border-width:2px;
            background:rgba(80,20,20,0.20);
            box-shadow:inset 0 0 0 1px rgba(255,70,70,0.18);
        }
        .lce-csh-card.has-friend {
            border-color:rgba(82,214,109,0.38);
            box-shadow:0 0 0 1px rgba(82,214,109,0.08) inset;
        }
        .lce-csh-card-top { display:flex; align-items:flex-start; gap:3px; padding-right:22px }
        .lce-csh-card-lock { font-size:11px; flex-shrink:0; line-height:1.4 }
        .lce-csh-card-name {
            font-size:12px; font-weight:600; color:var(--lce-text, #f0e8ff);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;
        }
        .lce-csh-card-info {
            position:absolute; top:5px; right:5px;
            width:18px; height:18px; border-radius:4px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.20));
            background:var(--lce-element-hover, rgba(255,255,255,0.08));
            color:var(--lce-text, #fff); opacity:0.75; font-size:10px;
            display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;
        }
        .lce-csh-card-owner {
            font-size:10px; color:var(--lce-text, #fff); opacity:0.60;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        .lce-csh-card-desc {
            font-size:10px; color:var(--lce-text, #fff); opacity:0.72;
            overflow:hidden; display:-webkit-box;
            -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.35; flex:1;
        }
        .lce-csh-card-foot {
            display:flex; justify-content:flex-start; align-items:center;
            font-size:10px; color:rgba(160,200,255,0.72);
            padding-top:2px; margin-top:auto; gap:5px;
        }
        .lce-csh-card-count { white-space:nowrap }
        .lce-csh-card-count.full { color:rgba(255,90,90,0.98); font-weight:800 }
        .lce-csh-card-rel { display:inline-flex; align-items:center; gap:4px; white-space:nowrap; font-size:10px; font-weight:700 }
        .lce-csh-card-rel .dot { width:7px; height:7px; border-radius:999px; display:inline-block }
        .lce-csh-card-rel.friend { color:rgba(90,230,120,0.95) }
        .lce-csh-card-rel.friend .dot { background:#52d66d }
        .lce-csh-card-rel.lover { color:rgba(255,120,210,0.95) }
        .lce-csh-card-rel.lover .dot { background:#ff66c4 }
        .lce-csh-card-rel.owner { color:rgba(255,175,90,0.98) }
        .lce-csh-card-rel.owner .dot { background:#ff9b3d }
        .lce-csh-empty {
            grid-column:1 / -1; text-align:center;
            color:var(--lce-text, #fff); opacity:0.28; font-size:13px; padding:50px 0;
        }

        #lce-csh-footer {
            flex-shrink:0; height:${FOOTER_H}px;
            display:flex; align-items:center; padding:0 8px; gap:6px; box-sizing:border-box;
            background:var(--lce-element, #12121e);
            border-top:1px solid var(--lce-accent, rgba(255,255,255,0.10));
        }
        #lce-csh-foot-left { flex:1 }
        #lce-csh-foot-pages { display:flex; align-items:center; gap:6px; flex:2; justify-content:center }
        #lce-csh-foot-right { flex:1; display:flex; justify-content:flex-end }
        .lce-csh-page-btn {
            height:34px; padding:0 14px; border-radius:8px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            background:var(--lce-element-hover, rgba(255,255,255,0.07));
            color:var(--lce-text, #fff); font-size:12px; cursor:pointer; white-space:nowrap;
        }
        .lce-csh-page-btn:active { background:var(--lce-element-active, rgba(255,255,255,0.18)) }
        .lce-csh-page-btn.disabled { opacity:0.30; pointer-events:none }
        #lce-csh-pageinfo { font-size:11px; color:var(--lce-text, #fff); opacity:0.45; white-space:nowrap }
        #lce-csh-exit-btn {
            height:34px; padding:0 14px; border-radius:8px;
            border:1px solid rgba(255,100,100,0.30);
            background:rgba(80,20,20,0.40);
            color:rgba(255,160,160,0.85); font-size:12px; cursor:pointer;
        }
        #lce-csh-exit-btn:active { background:rgba(120,30,30,0.60) }

        /* 房間詳情 bottom sheet */
        #lce-csh-info-backdrop {
            position:fixed; inset:0; z-index:80; background:rgba(0,0,0,0.52);
            display:flex; align-items:flex-end; justify-content:center;
        }
        #lce-csh-info-sheet {
            width:100%; max-width:768px; max-height:82vh; overflow:auto;
            background:var(--lce-element, #151522);
            border-top-left-radius:18px; border-top-right-radius:18px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.10));
            box-shadow:0 -10px 30px rgba(0,0,0,0.35);
            padding:14px 14px 16px; box-sizing:border-box;
        }
        #lce-csh-info-handle { width:42px; height:4px; border-radius:999px; background:var(--lce-accent, rgba(255,255,255,0.20)); margin:0 auto 12px }
        #lce-csh-info-head { display:flex; align-items:flex-start; gap:8px }
        #lce-csh-info-main { flex:1; min-width:0 }
        #lce-csh-info-title { font-size:16px; font-weight:700; color:var(--lce-text, #f3ecff); line-height:1.3; word-break:break-word }
        #lce-csh-info-owner { margin-top:3px; font-size:12px; color:var(--lce-text, #fff); opacity:0.72 }
        #lce-csh-info-close {
            flex-shrink:0; width:34px; height:34px; border-radius:9px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.14));
            background:var(--lce-element-hover, rgba(255,255,255,0.06));
            color:var(--lce-text, #fff); cursor:pointer;
        }
        #lce-csh-info-desc {
            margin-top:12px; font-size:13px; line-height:1.55;
            color:var(--lce-text, #fff); opacity:0.88; white-space:pre-wrap; word-break:break-word;
        }
        #lce-csh-info-tags { margin-top:12px; display:flex; flex-wrap:wrap; gap:6px }
        .lce-csh-tag {
            padding:6px 10px; border-radius:999px;
            background:var(--lce-element-hover, rgba(255,255,255,0.07));
            border:1px solid var(--lce-accent, rgba(255,255,255,0.10));
            color:var(--lce-text, #e9defa); font-size:11px; line-height:1.2;
        }
        #lce-csh-info-people { margin-top:12px; display:flex; flex-direction:column; gap:6px }
        .lce-csh-info-person {
            display:flex; align-items:center; gap:8px;
            padding:8px 10px; border-radius:10px;
            background:var(--lce-element-hover, rgba(255,255,255,0.05));
            border:1px solid var(--lce-accent, rgba(255,255,255,0.08));
            font-size:12px; color:var(--lce-text, #efe7ff);
        }
        .lce-csh-rel-dot { width:8px; height:8px; border-radius:999px; flex-shrink:0 }
        .lce-csh-rel-dot.friend { background:#52d66d }
        .lce-csh-rel-dot.lover { background:#ff66c4 }
        .lce-csh-rel-dot.owner { background:#ff9b3d }
        .lce-csh-rel-label { font-size:11px; color:var(--lce-text, #fff); opacity:0.55; margin-left:auto }
        #lce-csh-info-footer { margin-top:14px; display:flex; align-items:center; gap:8px }
        #lce-csh-info-members { flex:1; font-size:12px; color:rgba(160,200,255,0.82) }
        #lce-csh-info-join {
            height:38px; padding:0 16px; border-radius:10px;
            border:1px solid var(--lce-main, rgba(120,80,220,0.55));
            background:var(--lce-main, rgba(100,60,200,0.28));
            color:var(--lce-text, #fff); font-size:13px; font-weight:700; cursor:pointer;
        }
        #lce-csh-info-join.disabled { opacity:0.4; pointer-events:none }
    `;
}

export function cshApply() {
    if (cshActive) return;
    cshActive = true;
    cshNeedSync = false;
    cshPage = 1;
    cshAnimating = false;
    cshDrag = null;

    forceCanvasStyle(0);   // ChatSearch 不需要顯示角色，canvas 收成 0 高
    injectStyle('lce-v-csh-hide', CSH_BC_IDS.map(id => `#${id} { display:none !important }`).join('\n'));
    injectStyle('lce-v-csh', cshStyles());
    buildCshShell();
}

function makeHBtn(imgSrc, ariaLabel, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = 'lce-csh-hbtn' + (extraClass ? ' ' + extraClass : '');
    btn.setAttribute('aria-label', ariaLabel);
    if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.style.cssText = 'width:26px;height:26px;object-fit:contain;pointer-events:none;';
        img.onerror = () => { img.style.display = 'none'; btn.textContent = ariaLabel.slice(0, 2); };
        btn.appendChild(img);
    }
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

function cshAnimatePageTurn(dir) {
    const track = document.getElementById('lce-csh-shell')?._track;
    if (!track || cshAnimating) return;

    const perPage = Math.max(1, calcCshPerPage());
    const totalPages = Math.max(1, Math.ceil(cshRoomsCache.length / perPage));
    const targetPage = cshPage + dir;
    if (targetPage < 1 || targetPage > totalPages) return;

    cshAnimating = true;
    track.classList.add('animating');
    track.style.transform = `translateX(${dir > 0 ? '-100%' : '100%'})`;
    track.addEventListener('transitionend', () => {
        cshPage = targetPage;
        renderCshList(false);
        cshAnimating = false;
    }, { once: true });
}

function buildRoomCard(room) {
    // 一律優先點 BC 原生的 join button，讓 BC 自己跑加入流程
    const joinBtn = room?.Order != null
        ? document.getElementById(`chat-search-room-join-button-${room.Order}`)
        : null;

    const name = room.Name || T('v_room_unnamed');
    const memberCount = room.MemberCount ?? null;
    const limit = room.MemberLimit ?? null;
    const isFull = memberCount !== null && limit !== null && memberCount >= limit;
    const hasFriend = Array.isArray(room.Friends) && room.Friends.length > 0;

    const card = document.createElement('div');
    card.className = 'lce-csh-card' + (isFull ? ' full' : '') + (hasFriend ? ' has-friend' : '');

    const top = document.createElement('div');
    top.className = 'lce-csh-card-top';
    if (!room.CanJoin) {
        const lockEl = document.createElement('span');
        lockEl.className = 'lce-csh-card-lock';
        lockEl.textContent = '🔒';
        top.appendChild(lockEl);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'lce-csh-card-name';
    nameEl.textContent = name;
    top.appendChild(nameEl);
    card.appendChild(top);

    const infoBtn = document.createElement('button');
    infoBtn.className = 'lce-csh-card-info';
    infoBtn.textContent = 'ⓘ';
    infoBtn.setAttribute('aria-label', T('v_room_info_aria'));
    infoBtn.addEventListener('click', (e) => { e.stopPropagation(); cshShowRoomInfo(room); });
    card.appendChild(infoBtn);

    if (room.Creator) {
        const ownerEl = document.createElement('div');
        ownerEl.className = 'lce-csh-card-owner';
        ownerEl.textContent = T('v_room_by_prefix') + room.Creator;
        card.appendChild(ownerEl);
    }
    if (room.Description) {
        const descEl = document.createElement('div');
        descEl.className = 'lce-csh-card-desc';
        descEl.textContent = room.Description;
        card.appendChild(descEl);
    }

    const foot = document.createElement('div');
    foot.className = 'lce-csh-card-foot';
    const cnt = document.createElement('span');
    cnt.className = 'lce-csh-card-count' + (isFull ? ' full' : '');
    cnt.textContent = memberCount !== null ? `👥 ${memberCount}${limit !== null ? '/' + limit : ''}` : '';
    foot.appendChild(cnt);

    // 同一種關係只顯示一個標籤，但不同關係都要顯示
    for (const relType of new Set(getRoomRelations(room).map(p => p.relation))) {
        const rel = document.createElement('span');
        rel.className = `lce-csh-card-rel ${relType}`;
        const dot = document.createElement('span');
        dot.className = 'dot';
        const text = document.createElement('span');
        text.textContent = T(`v_rel_${relType}`);
        rel.append(dot, text);
        foot.appendChild(rel);
    }
    card.appendChild(foot);

    card.addEventListener('click', () => {
        if (joinBtn) joinBtn.click();
        else if (typeof ChatSearchClickRoom === 'function') ChatSearchClickRoom(room);
    });
    return card;
}

function buildCshShell() {
    document.getElementById('lce-csh-shell')?.remove();
    const shell = document.createElement('div');
    shell.id = 'lce-csh-shell';

    // ── Header ──
    const header = document.createElement('div');
    header.id = 'lce-csh-header';

    const wrap = document.createElement('div');
    wrap.id = 'lce-csh-search-wrap';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.setAttribute('placeholder', T('v_csh_search_ph'));
    inp.value = typeof ChatSearchQueryString !== 'undefined' ? ChatSearchQueryString : '';

    const clearBtn = document.createElement('button');
    clearBtn.id = 'lce-csh-clear';
    clearBtn.textContent = '✕';
    clearBtn.setAttribute('aria-label', T('v_csh_clear_aria'));
    if (inp.value) clearBtn.classList.add('visible');
    clearBtn.addEventListener('click', () => {
        inp.value = '';
        clearBtn.classList.remove('visible');
        if (typeof ChatSearchQuery === 'function') ChatSearchQuery('');
    });
    inp.addEventListener('input', () => {
        clearBtn.classList.toggle('visible', inp.value.length > 0);
        clearTimeout(inp._deb);
        inp._deb = setTimeout(() => {
            if (typeof ChatSearchQuery === 'function') ChatSearchQuery(inp.value);
        }, 400);
    });
    wrap.append(inp, clearBtn);
    header.appendChild(wrap);

    header.appendChild(makeHBtn(BASE_URL + 'Icons/Search.png', T('v_csh_filter_aria'), () => {
        const bcFilterBtn = findChatSearchButton('filter');
        if (bcFilterBtn) { bcFilterBtn.style.removeProperty('display'); bcFilterBtn.click(); }
        else console.warn(LOG, '找不到原生篩選按鈕，BC 介面可能已更新');
    }));

    const spaceBtn = makeHBtn(getSpaceButtonIcon(), getSpaceButtonLabel(), () => {
        if (playerHasMaleGender()) { refreshCshSpaceButton(); return; }
        applySpace(getToggleTargetSpace(), inp.value ?? '');
        refreshCshSpaceButton();
    });
    spaceBtn.id = 'lce-csh-space-btn';
    header.appendChild(spaceBtn);

    header.appendChild(makeHBtn(BASE_URL + 'Icons/Plus.png', T('v_csh_create_aria'), () => {
        const bcCreate = findChatSearchButton('create');
        if (bcCreate) { bcCreate.style.removeProperty('display'); bcCreate.click(); return; }
        if (typeof ChatSearchCreateRoom === 'function') ChatSearchCreateRoom();
        else console.warn(LOG, '找不到原生建立房間按鈕，BC 介面可能已更新');
    }, 'create'));

    shell.appendChild(header);

    // ── 列表 ──
    const list = document.createElement('div');
    list.id = 'lce-csh-list';
    const track = document.createElement('div');
    track.id = 'lce-csh-track';
    list.appendChild(track);
    shell._list = list;
    shell._track = track;
    shell.appendChild(list);

    // ── Footer ──
    const footer = document.createElement('div');
    footer.id = 'lce-csh-footer';
    const footLeft = document.createElement('div');
    footLeft.id = 'lce-csh-foot-left';
    const footPages = document.createElement('div');
    footPages.id = 'lce-csh-foot-pages';
    const footRight = document.createElement('div');
    footRight.id = 'lce-csh-foot-right';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'lce-csh-page-btn disabled';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', T('v_csh_prev_aria'));
    prevBtn.addEventListener('click', () => cshAnimatePageTurn(-1));

    const pageInfo = document.createElement('span');
    pageInfo.id = 'lce-csh-pageinfo';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'lce-csh-page-btn disabled';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', T('v_csh_next_aria'));
    nextBtn.addEventListener('click', () => cshAnimatePageTurn(1));

    footPages.append(prevBtn, pageInfo, nextBtn);

    const exitBtn = document.createElement('button');
    exitBtn.id = 'lce-csh-exit-btn';
    exitBtn.textContent = T('v_csh_exit_btn');
    exitBtn.addEventListener('click', () => {
        const bcExit = findChatSearchButton('exit');
        if (bcExit) { bcExit.click(); return; }
        if (typeof ChatSearchExit === 'function') ChatSearchExit();
        else if (typeof CommonSetScreen === 'function') CommonSetScreen('Online', 'ChatSelect');
        else console.warn(LOG, '找不到原生離開按鈕，BC 介面可能已更新');
    });
    footRight.appendChild(exitBtn);

    footer.append(footLeft, footPages, footRight);
    shell.appendChild(footer);

    shell._prev = prevBtn;
    shell._next = nextBtn;
    shell._pageInfo = pageInfo;

    document.body.appendChild(shell);

    // 男性角色只能進混區
    if (playerHasMaleGender() && getCurrentSpace() !== 'X') applySpace('X', inp.value ?? '');

    refreshCshSpaceButton();
    renderCshList();
    cshBindSwipe(list);
}

function getCshPageRooms(page) {
    const perPage = Math.max(1, calcCshPerPage());
    const totalPages = Math.max(1, Math.ceil(cshRoomsCache.length / perPage));
    if (page < 1 || page > totalPages) return [];
    const start = (page - 1) * perPage;
    return cshRoomsCache.slice(start, start + perPage);
}

function fillCshPage(panel, rooms) {
    panel.innerHTML = '';
    for (const room of rooms) panel.appendChild(buildRoomCard(room));
}

/** 把軌道瞬間歸位（不要有過場動畫）。 */
function cshResetTrackPosition(track, value = 'translateX(0)') {
    if (!track) return;
    track.classList.remove('animating');
    track.style.setProperty('transition', 'none', 'important');
    track.style.transform = value;
    void track.offsetHeight;   // 強制 reflow，確保 transition:none 生效後再解除
    track.style.removeProperty('transition');
}

export function renderCshList(resetPage = false) {
    const shell = document.getElementById('lce-csh-shell');
    const track = shell?._track;
    if (!shell || !track) return;

    cshRoomsCache = getCshRoomsSource();
    const perPage = Math.max(1, calcCshPerPage());
    const totalRooms = cshRoomsCache.length;
    const totalPages = Math.max(1, Math.ceil(totalRooms / perPage));

    if (resetPage) cshPage = 1;
    cshPage = Math.min(Math.max(1, cshPage), totalPages);

    track.innerHTML = '';
    const prev = document.createElement('div');
    prev.className = 'lce-csh-page prev';
    const curr = document.createElement('div');
    curr.className = 'lce-csh-page curr';
    const next = document.createElement('div');
    next.className = 'lce-csh-page next';

    fillCshPage(prev, getCshPageRooms(cshPage - 1));
    fillCshPage(curr, getCshPageRooms(cshPage));
    fillCshPage(next, getCshPageRooms(cshPage + 1));

    if (!curr.childElementCount) {
        const emp = document.createElement('div');
        emp.className = 'lce-csh-empty';
        emp.textContent = T('v_csh_no_rooms');
        curr.appendChild(emp);
    }

    track.append(prev, curr, next);
    cshResetTrackPosition(track);

    shell._prev.className = 'lce-csh-page-btn' + (cshPage > 1 ? '' : ' disabled');
    shell._next.className = 'lce-csh-page-btn' + (cshPage < totalPages ? '' : ' disabled');
    shell._pageInfo.textContent = totalRooms > 0
        ? T('v_csh_page_info').replace('$page', cshPage).replace('$total', totalPages).replace('$count', totalRooms)
        : '0/0';

    refreshCshSpaceButton();
}

/** 左右滑動翻頁；到頭到尾時加阻尼（dx*0.22）讓使用者感覺得到邊界。 */
function cshBindSwipe(list) {
    if (!list || list._lceSwipeBound) return;
    list._lceSwipeBound = true;

    list.addEventListener('pointerdown', (e) => {
        if (cshAnimating) return;
        cshDrag = { startX: e.clientX, dx: 0, dragging: true };
    });

    list.addEventListener('pointermove', (e) => {
        if (!cshDrag?.dragging) return;
        const track = document.getElementById('lce-csh-shell')?._track;
        if (!track) return;

        let dx = e.clientX - cshDrag.startX;
        const perPage = Math.max(1, calcCshPerPage());
        const totalPages = Math.max(1, Math.ceil(cshRoomsCache.length / perPage));
        if ((dx > 0 && cshPage <= 1) || (dx < 0 && cshPage >= totalPages)) dx *= 0.22;

        cshDrag.dx = dx;
        track.classList.remove('animating');
        track.style.transform = `translateX(${dx}px)`;
    }, { passive: true });

    const endDrag = () => {
        if (!cshDrag?.dragging) return;
        const track = document.getElementById('lce-csh-shell')?._track;
        if (!track) return;

        const dx = cshDrag.dx;
        cshDrag = null;

        const perPage = Math.max(1, calcCshPerPage());
        const totalPages = Math.max(1, Math.ceil(cshRoomsCache.length / perPage));
        const threshold = Math.min(120, window.innerWidth * 0.20);

        const commit = (delta, to) => {
            cshAnimating = true;
            track.classList.add('animating');
            track.style.transform = to;
            track.addEventListener('transitionend', () => {
                cshAnimating = false;
                cshPage += delta;
                renderCshList(false);
            }, { once: true });
        };

        if (dx > threshold && cshPage > 1) { commit(-1, 'translateX(100%)'); return; }
        if (dx < -threshold && cshPage < totalPages) { commit(1, 'translateX(-100%)'); return; }

        track.classList.add('animating');
        track.style.transform = 'translateX(0)';
    };

    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);
}

function cshCloseRoomInfo() {
    document.getElementById('lce-csh-info-backdrop')?.remove();
}

function cshShowRoomInfo(room) {
    cshCloseRoomInfo();

    const backdrop = document.createElement('div');
    backdrop.id = 'lce-csh-info-backdrop';
    backdrop.addEventListener('click', cshCloseRoomInfo);
    // 擋掉 pointer 事件，否則會被下層的翻頁滑動接走
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) {
        backdrop.addEventListener(t, (e) => e.stopPropagation());
    }

    const sheet = document.createElement('div');
    sheet.id = 'lce-csh-info-sheet';
    sheet.addEventListener('click', (e) => e.stopPropagation());

    const handle = document.createElement('div');
    handle.id = 'lce-csh-info-handle';
    sheet.appendChild(handle);

    const head = document.createElement('div');
    head.id = 'lce-csh-info-head';
    const main = document.createElement('div');
    main.id = 'lce-csh-info-main';
    const title = document.createElement('div');
    title.id = 'lce-csh-info-title';
    title.textContent = room.Name || T('v_room_unnamed');
    const ownerEl = document.createElement('div');
    ownerEl.id = 'lce-csh-info-owner';
    ownerEl.textContent = room.Creator ? T('v_room_by_prefix') + room.Creator : '';
    main.append(title, ownerEl);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'lce-csh-info-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', cshCloseRoomInfo);
    head.append(main, closeBtn);
    sheet.appendChild(head);

    const descEl = document.createElement('div');
    descEl.id = 'lce-csh-info-desc';
    descEl.textContent = room.Description || T('v_room_no_desc');
    sheet.appendChild(descEl);

    const tagsWrap = document.createElement('div');
    tagsWrap.id = 'lce-csh-info-tags';
    for (const tagText of buildRoomTags(room)) {
        const tag = document.createElement('div');
        tag.className = 'lce-csh-tag';
        tag.textContent = tagText;
        tagsWrap.appendChild(tag);
    }
    sheet.appendChild(tagsWrap);

    const people = getRoomRelations(room);
    if (people.length) {
        const peopleWrap = document.createElement('div');
        peopleWrap.id = 'lce-csh-info-people';
        for (const p of people) {
            const row = document.createElement('div');
            row.className = 'lce-csh-info-person';
            const dot = document.createElement('span');
            dot.className = `lce-csh-rel-dot ${p.relation}`;
            const name = document.createElement('span');
            name.textContent = p.memberName;
            const label = document.createElement('span');
            label.className = 'lce-csh-rel-label';
            label.textContent = T(`v_rel_${p.relation}`);
            row.append(dot, name, label);
            peopleWrap.appendChild(row);
        }
        sheet.appendChild(peopleWrap);
    }

    const footer = document.createElement('div');
    footer.id = 'lce-csh-info-footer';
    const members = document.createElement('div');
    members.id = 'lce-csh-info-members';
    members.textContent = `${room.MemberCount ?? 0} / ${room.MemberLimit ?? '?'}`;

    const canJoin = !!(room.CanJoin && (room.MemberCount ?? 0) < (room.MemberLimit ?? 999));
    const joinBtn2 = document.createElement('button');
    joinBtn2.id = 'lce-csh-info-join';
    joinBtn2.textContent = T(canJoin ? 'v_room_can_join' : 'v_room_cannot_join');
    if (!canJoin) joinBtn2.classList.add('disabled');
    joinBtn2.addEventListener('click', () => {
        if (!canJoin) return;
        cshCloseRoomInfo();
        const joinBtnDom = room?.Order != null
            ? document.getElementById(`chat-search-room-join-button-${room.Order}`)
            : null;
        if (joinBtnDom) joinBtnDom.click();
        else if (typeof ChatSearchClickRoom === 'function') ChatSearchClickRoom(room);
    });

    footer.append(members, joinBtn2);
    sheet.appendChild(footer);

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
}

export function cshRemove() {
    if (!cshActive) return;
    cshActive = false;
    cshAnimating = false;
    cshDrag = null;

    if (cshSyncTimer) clearTimeout(cshSyncTimer);
    cshSyncTimer = null;
    cshNeedSync = false;
    cshCloseRoomInfo();
    clearCanvasStyle();
    removeStyle('lce-v-csh-hide');
    removeStyle('lce-v-csh');
    document.getElementById('lce-csh-shell')?.remove();
}
