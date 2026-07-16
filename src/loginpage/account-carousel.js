// ════════════════════════════════════════════════════════════════════════════
// 帳號保存區 —— 垂直摩天輪 / 旋轉木馬式選擇（點3）
// 無外框、無卷軸；支援按壓拖曳與滾輪轉動。選定的帳號置中放大，越遠越縮小淡出，
// 並循環（轉到最後一筆會回到第一筆）。帳號少於 3 筆時補虛擬卡填位。
// ════════════════════════════════════════════════════════════════════════════

import { CANVAS_W } from '../core/constants.js';
import { S } from '../core/state.js';
import { T } from '../core/i18n.js';
import { mk } from '../core/util.js';
import {
    loadAccounts, removeAccount, dbGet, dbDelete, decryptPassword, ACCOUNTS_UPDATED_EVENT,
} from '../core/storage.js';

const MIN_CARDS = 3;    // 少於此數以虛擬卡填位
const STEP_DEG  = 22;   // 相鄰卡片的角度間隔
const RADIUS    = 330;  // 輪徑（canvas 單位）—— 越大卡片垂直間距越大
const VISIBLE   = 3.2;  // 只顯示 ±VISIBLE 範圍內的卡片
const ONE_CARD_PX = RADIUS * Math.sin(STEP_DEG * Math.PI / 180); // 一張卡約略的 y 位移

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

        area.appendChild(card);
        cards.push({ el: card, account: item.account, virtual: item.virtual });
    });

    // 初始置中位置
    let start = 0;
    if (focusName) {
        const fi = cards.findIndex(c => !c.virtual && c.account.accountName === focusName);
        if (fi >= 0) start = fi;
    }
    pos = start;
    layout();
    attachWheelAndPointer(area);
    settle();
}

/** 依 pos 擺放每張卡片 */
function layout() {
    cards.forEach((c, i) => {
        const d = wrapDelta(i - pos);
        const absd = Math.abs(d);
        if (absd > VISIBLE) { c.el.style.opacity = '0'; c.el.style.visibility = 'hidden'; return; }
        c.el.style.visibility = 'visible';
        const ang   = d * STEP_DEG * Math.PI / 180;
        const y     = RADIUS * Math.sin(ang);
        const scale = Math.max(0.42, Math.cos(ang));
        c.el.style.transform = `translate(-50%, -50%) translateY(${y}px) scale(${scale})`;
        c.el.style.opacity   = String(Math.max(0.12, 1 - absd * 0.24));
        c.el.style.zIndex    = String(Math.round(100 - absd * 10));
        c.el.classList.toggle('center', absd < 0.5);
    });
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

/** 把帳號填入登入表單並解密密碼 */
function fillForm(account) {
    const nameEl = document.getElementById('lce-input-name');
    const passEl = document.getElementById('lce-input-pass');
    if (nameEl) nameEl.value = account.accountName;
    if (passEl) passEl.value = '';
    decryptPassword(account.password).then(plain => {
        const idx = ((Math.round(pos) % n) + n) % n;
        if (cards[idx]?.account !== account) return; // 已轉走
        const el = document.getElementById('lce-input-pass');
        if (el) el.value = plain ?? '';
    });
}

// ── 互動：滾輪 + 按壓拖曳 ────────────────────────────────────────────────────

function attachWheelAndPointer(area) {
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('pointerdown', onPointerDown);
}

function onWheel(e) {
    e.preventDefault();
    animateTo(pos + (e.deltaY > 0 ? 1 : -1));
}

function onPointerDown(e) {
    dragging = true; dragMoved = false;
    dragStartY = e.clientY; dragStartPos = pos;
    setDragging(true); // 拖曳時關閉過場動畫，跟手
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    if (!dragging) return;
    const dyCanvas = (e.clientY - dragStartY) / getStageScale();
    if (Math.abs(e.clientY - dragStartY) > 4) dragMoved = true;
    // 往下拖（clientY 變大）→ 轉到上一張（pos 減少）
    pos = dragStartPos - dyCanvas / ONE_CARD_PX;
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
