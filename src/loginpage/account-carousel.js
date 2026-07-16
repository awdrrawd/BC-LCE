// ════════════════════════════════════════════════════════════════════════════
// 帳號保存區 —— 摩天輪 / 旋轉木馬式選擇（點3）
// 無外框、無卷軸；支援按壓拖曳與滾輪轉動。選定的帳號置中放大，越遠越縮小淡出，
// 並循環（轉到最後一筆會回到第一筆）。帳號少於 3 筆時補虛擬卡填位。
//
// 軸向可切換：橫向版面用垂直輪（右側直排），直向版面用水平輪（帳號列橫向排開，
// 對齊 MPL 的直式版面）。兩者共用同一份卡片 DOM 與同一套角度數學，只差投影軸。
// ════════════════════════════════════════════════════════════════════════════

import { CANVAS_W, LOGIN_REQUEST_EVENT } from '../core/constants.js';
import { S } from '../core/state.js';
import { T } from '../core/i18n.js';
import { mk } from '../core/util.js';
import {
    loadAccounts, removeAccount, dbGet, dbDelete, decryptPassword, ACCOUNTS_UPDATED_EVENT,
} from '../core/storage.js';

const MIN_CARDS = 3;    // 少於此數以虛擬卡填位
const STEP_DEG  = 22;   // 相鄰卡片的角度間隔
const VISIBLE   = 3.2;  // 只顯示 ±VISIBLE 範圍內的卡片

// 輪徑：垂直輪用 canvas 單位（stage 有縮放）；水平輪用螢幕 px（直向 stage 不縮放）。
// 相鄰卡的間距 = RADIUS * sin(STEP_DEG)：
//   垂直 330 → 124，剛好等於卡高 120，卡片相接不重疊。
//   水平 360 → 135，略小於直式卡寬 160，讓相鄰卡稍微疊在中央卡下方（coverflow 的樣子），
//              手機寬度下大約可看到中央卡 + 左右各一張。
const RADIUS_Y = 330;
const RADIUS_X = 360;

/** @type {'y'|'x'} 目前的輪軸；由 login-ui 依螢幕方向設定 */
let axis = 'y';
const radius = () => (axis === 'y' ? RADIUS_Y : RADIUS_X);
/** 一張卡約略的位移量（滾輪一格 = 轉一張卡） */
const oneCardPx = () => radius() * Math.sin(STEP_DEG * Math.PI / 180);

/** @type {{el:HTMLElement, account:object|null, virtual:boolean}[]} */
let cards = [];
let pos   = 0;   // 連續位置（浮點）
let n     = 0;   // 顯示卡數（含虛擬）
let dragging = false, dragStartY = 0, dragStartPos = 0, dragMoved = false;
let settleTimer = null;

/** 把差值 wrap 到最短的有號距離 [-n/2, n/2] */
function wrapDelta(x) {
    if (n === 0) return 0;
    x = ((x % n) + n) % n;
    if (x > n / 2) x -= n;
    return x;
}

/** 取得 stage 目前的縮放比（螢幕 px → canvas 單位換算用） */
function getStageScale() {
    const cv = document.getElementById('MainCanvas') || document.querySelector('canvas');
    if (cv && cv.clientWidth) return cv.clientWidth / CANVAS_W;
    return 1;
}

/**
 * （重）建立輪盤。
 * @param {string} [focusName] 建立後要置中的帳號名稱（例如剛保存的帳號）
 */
export function buildCarousel(focusName) {
    const area = document.getElementById('lce-acct-area');
    if (!area) return;
    detachDragListeners();
    area.innerHTML = '';
    cards = [];

    const accounts = loadAccounts();
    if (accounts.length === 0) {
        const empty = mk('div', '', { textContent: T('no_accounts') });
        empty.className = 'lce-acct-empty'; empty.dataset.lceKey = 'no_accounts';
        area.appendChild(empty);
        n = 0;
        return;
    }

    // 顯示清單：真實帳號 + 補足到 MIN_CARDS 的虛擬卡
    const list = accounts.map(a => ({ account: a, virtual: false }));
    while (list.length < MIN_CARDS) list.push({ account: null, virtual: true });
    n = list.length;

    list.forEach((item, idx) => {
        const card = mk('div');
        card.className = 'lce-acct-card' + (item.virtual ? ' virtual' : '');

        const av = mk('div'); av.className = 'lce-avatar';
        const ph = mk('span', '', { textContent: item.virtual ? '＋' : '🐈' }); av.appendChild(ph);

        const info = mk('div'); info.className = 'lce-acct-info';
        const acctNm = mk('div', '', { textContent: item.virtual ? '' : item.account.accountName }); acctNm.className = 'lce-acct-acct';
        const nm = mk('div', '', { textContent: '' }); nm.className = 'lce-acct-nm';
        const id = mk('div', '', { textContent: '' }); id.className = 'lce-acct-id';
        info.appendChild(acctNm); info.appendChild(nm); info.appendChild(id);

        card.appendChild(av); card.appendChild(info);

        if (!item.virtual) {
            const del = mk('div', '', { textContent: '✕' }); del.className = 'lce-acct-del';
            del.addEventListener('click', e => { e.stopPropagation(); deleteAt(idx); });
            card.appendChild(del);

            // 非同步載入角色快照（頭像 + 名稱 + ID）
            dbGet(item.account.accountName).then(profile => {
                if (!profile) return;
                const displayName = profile.nickname || profile.name || '';
                if (displayName) nm.textContent = displayName;
                if (profile.memberNumber) id.textContent = '#' + profile.memberNumber;
                if (profile.avatarDataUrl) {
                    const img = mk('img', '', { src: profile.avatarDataUrl, alt: displayName });
                    av.innerHTML = ''; av.appendChild(img);
                }
            });
        }

        // 點擊：中間卡→選取；旁邊卡→轉到中間
        card.addEventListener('click', () => {
            if (dragMoved) return;
            const d = Math.round(wrapDelta(idx - pos));
            if (d === 0) { if (!item.virtual) fillForm(item.account); }
            else animateTo(pos + d);
        });

        // 連點兩下：直接登入。
        // 只有「已經選定（置中）」的卡才接受連點，避免在旁邊的卡上連點就誤登入 ——
        // 第一次點會把卡轉到中間（上面的 click），確認選對人之後再連點兩下才送出。
        if (!item.virtual) {
            card.addEventListener('dblclick', async () => {
                if (dragMoved) return;
                if (Math.round(wrapDelta(idx - pos)) !== 0) return;   // 未置中 → 不觸發
                await fillForm(item.account, true);   // 必須等密碼解密填完才能送出
                window.dispatchEvent(new CustomEvent(LOGIN_REQUEST_EVENT));
            });
        }

        area.appendChild(card);
        cards.push({ el: card, account: item.account, virtual: item.virtual });
    });

    // 初始置中位置：優先用指定的帳號，否則自動選定上次成功登入的帳號
    let start = 0;
    const wanted = focusName || S.settings.lastAccount;
    if (wanted) {
        const fi = cards.findIndex(c => !c.virtual && c.account.accountName === wanted);
        if (fi >= 0) start = fi;
    }
    pos = start;
    layout();
    attachWheelAndPointer(area);
    settle();
}

/** 依 pos 擺放每張卡片 */
function layout() {
    const r = radius();
    cards.forEach((c, i) => {
        const d = wrapDelta(i - pos);
        const absd = Math.abs(d);
        if (absd > VISIBLE) { c.el.style.opacity = '0'; c.el.style.visibility = 'hidden'; return; }
        c.el.style.visibility = 'visible';
        const ang   = d * STEP_DEG * Math.PI / 180;
        const off   = r * Math.sin(ang);
        const scale = Math.max(0.42, Math.cos(ang));
        const move  = axis === 'y' ? `translateY(${off}px)` : `translateX(${off}px)`;
        c.el.style.transform = `translate(-50%, -50%) ${move} scale(${scale})`;
        c.el.style.opacity   = String(Math.max(0.12, 1 - absd * 0.24));
        c.el.style.zIndex    = String(Math.round(100 - absd * 10));
        c.el.classList.toggle('center', absd < 0.5);
    });
}

/**
 * 切換輪軸並立刻重排。'y' = 垂直（橫向版面）、'x' = 水平（直向版面）。
 * 保持目前選定的位置不變，使用者轉螢幕不會跳掉。
 */
export function setCarouselAxis(a) {
    const next = a === 'x' ? 'x' : 'y';
    if (next === axis) return;
    axis = next;
    layout();
}

function setDragging(on) {
    const area = document.getElementById('lce-acct-area');
    area?.classList.toggle('dragging', on);
}

/** 平滑轉到某個（可為非整數的）位置，動畫結束後正規化並選取 */
function animateTo(target) {
    setDragging(false);
    pos = target;
    layout();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        pos = ((Math.round(pos) % n) + n) % n;
        layout();
        settle();
    }, 340);
}

/** 選定目前置中的卡片（真實帳號才填入表單） */
function settle() {
    if (n === 0) return;
    const idx = ((Math.round(pos) % n) + n) % n;
    const c = cards[idx];
    if (c && !c.virtual) { fillForm(c.account); S.selectedIdx = idx; }
    else S.selectedIdx = null;
}

/**
 * 把帳號填入登入表單並解密密碼。
 * @param {boolean} [force] 略過「是否仍置中」的檢查。連點登入時輪盤可能還在轉，
 *                          不強制的話密碼會因為已轉走而不填入 → 送出空密碼。
 * @returns {Promise<string|null>} 解密後的密碼（未填入時為 null）
 */
function fillForm(account, force = false) {
    const nameEl = document.getElementById('lce-input-name');
    const passEl = document.getElementById('lce-input-pass');
    if (nameEl) nameEl.value = account.accountName;
    if (passEl) passEl.value = '';
    return decryptPassword(account.password).then(plain => {
        if (!force) {
            const idx = ((Math.round(pos) % n) + n) % n;
            if (cards[idx]?.account !== account) return null; // 已轉走
        }
        const el = document.getElementById('lce-input-pass');
        if (el) el.value = plain ?? '';
        return plain ?? '';
    });
}

// ── 互動：滾輪 + 按壓拖曳 ────────────────────────────────────────────────────

function attachWheelAndPointer(area) {
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('pointerdown', onPointerDown);
}

function onWheel(e) {
    e.preventDefault();
    // 水平輪時橫向滾動也要能轉（觸控板/滑鼠的橫向滾輪）
    const delta = axis === 'y' ? e.deltaY : (e.deltaX || e.deltaY);
    animateTo(pos + (delta > 0 ? 1 : -1));
}

/** 依目前輪軸取出該追蹤的座標 */
const axisPos = (e) => (axis === 'y' ? e.clientY : e.clientX);

function onPointerDown(e) {
    dragging = true; dragMoved = false;
    dragStartY = axisPos(e); dragStartPos = pos;
    setDragging(true); // 拖曳時關閉過場動畫，跟手
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    if (!dragging) return;
    const raw = axisPos(e) - dragStartY;
    // 垂直輪的 stage 有縮放，要換算回 canvas 單位；水平輪的 stage 不縮放，直接用 px
    const d = axis === 'y' ? raw / getStageScale() : raw;
    if (Math.abs(raw) > 4) dragMoved = true;
    // 往下/往右拖 → 轉到上一張（pos 減少）
    pos = dragStartPos - d / oneCardPx();
    layout();
}

function onPointerUp() {
    dragging = false;
    detachDragListeners();
    animateTo(Math.round(pos));
    setTimeout(() => { dragMoved = false; }, 0);
}

function detachDragListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
}

// ── 刪除 ────────────────────────────────────────────────────────────────────

function deleteAt(idx) {
    const c = cards[idx];
    if (!c || c.virtual) return;
    removeAccount(c.account.accountName);
    dbDelete(c.account.accountName);
    S.selectedIdx = null;
    buildCarousel();
}

// ── 對外 ────────────────────────────────────────────────────────────────────

/** 供 login-ui / 事件使用的重刷入口 */
export const refreshAccounts = buildCarousel;

/** 熱移除時清掉殘留的 window 監聽 */
export function destroyCarousel() {
    detachDragListeners();
    clearTimeout(settleTimer);
    cards = []; n = 0; pos = 0;
}

// 登入成功後 storage 會發出此事件 → 重刷卡片（頭像/名稱/ID）
window.addEventListener(ACCOUNTS_UPDATED_EVENT, () => buildCarousel());
