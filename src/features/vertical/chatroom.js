// ════════════════════════════════════════════════════════════════════════════
// 直式聊天室（verticalChatRoom）—— 移植自 MPL 的 crXxx / drXxx
//
//   cr*  聊天室本體：canvas 佔上半螢幕，BC 原生的 #chat-room-div 與
//        #chat-room-top-menu 用 ChatRoomDivRect + ElementPositionFix 移到下半。
//   dr*  聊天室內開啟對話框（自介、表情、衣物選單）時：canvas 右半用 mirror
//        canvas 複製到下半螢幕，點擊再換算座標注回 BC。
//
// 兩者互斥，由 index.js 的 checkScene() 依有無 CurrentCharacter 切換。
// ════════════════════════════════════════════════════════════════════════════

import { getCanvas, injectStyle, removeStyle, isPortrait, getLockedVH, positionElement } from '../../core/util.js';
import { T } from '../../core/i18n.js';
import { MENU_PX, Z, forceCanvasStyle, clearCanvasStyle } from './common.js';

const LOG = '🐈‍⬛ [LCE]';

// ───────────────────────── 聊天室本體 ─────────────────────────
let crActive = false;
let crLockedVH = 0;
let crOrigRect = null;

export const isCrActive = () => crActive;

/** 算出 canvas 高度，以及選單／聊天框在 BC 虛擬座標系裡的位置。 */
function crCalc() {
    const vw = window.innerWidth;
    const vh = crLockedVH || window.innerHeight;
    const cvH = Math.round(vh * 0.5);
    const sx = (vw * 2) / 2000;      // 螢幕 px → BC 虛擬座標的縮放比
    const sy = cvH / 1000;
    const cSY = cvH + MENU_PX;
    const cSH = Math.max(120, vh - cSY);
    return {
        cvH,
        mLY: Math.round(cvH / sy),
        mLH: Math.round(MENU_PX / sy),
        mLW: Math.round(vw / sx),
        cLY: Math.round(cSY / sy),
        cLH: Math.round(cSH / sy),
    };
}

// ── 假輸入框 ──
// 手機鍵盤彈出會把整個版面推爆，所以攔截聊天輸入框的 focus，改開一個全螢幕
// 覆蓋層裡的假輸入框；使用者打完按送出，再把值寫回真正的輸入框並模擬 Enter。
let crFakeInputActive = false;

export const isFakeInputVisible = () =>
    crFakeInputActive || !!document.getElementById('lce-cr-fake-input-overlay');

function crShowFakeInput(realInput) {
    if (crFakeInputActive) return;
    crFakeInputActive = true;
    injectStyle('lce-cr-keyboard-lock', 'html, body { height: 100vh !important; overflow: hidden !important }');

    // 記住 id 而不是節點本身：BC 送出訊息後會重建輸入框，舊節點會失效
    const realInputId = realInput.id || null;
    const getLiveInput = () => (realInputId && document.getElementById(realInputId)) || realInput;

    // 先設 readonly 再拿掉，讓 iOS 不要彈出真鍵盤
    realInput.setAttribute('readonly', 'true');
    realInput.blur();
    requestAnimationFrame(() => { realInput.removeAttribute('readonly'); });

    const overlay = document.createElement('div');
    overlay.id = 'lce-cr-fake-input-overlay';

    const box = document.createElement('div');
    box.className = 'lce-cr-fake-box';

    const title = document.createElement('div');
    title.className = 'lce-cr-fake-title';
    title.textContent = T('v_fake_input_title');

    const ta = document.createElement('textarea');
    ta.className = 'lce-cr-fake-ta';
    ta.value = realInput.value || '';
    ta.placeholder = realInput.placeholder || '';
    ta.rows = 4;
    ta.setAttribute('enterkeyhint', 'send');

    const btnRow = document.createElement('div');
    btnRow.className = 'lce-cr-fake-btnrow';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'lce-cr-fake-btn';
    cancelBtn.textContent = T('v_fake_input_cancel');

    const sendBtn = document.createElement('button');
    sendBtn.className = 'lce-cr-fake-btn lce-cr-fake-btn-send';
    sendBtn.textContent = T('v_fake_input_send');

    const close = () => {
        crFakeInputActive = false;
        removeStyle('lce-cr-keyboard-lock');
        overlay.remove();
    };

    cancelBtn.addEventListener('click', close);
    sendBtn.addEventListener('click', () => {
        const target = getLiveInput();
        target.value = ta.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        for (const type of ['keydown', 'keypress', 'keyup']) {
            target.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
            }));
        }
        close();
    });
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    btnRow.append(cancelBtn, sendBtn);
    box.append(title, ta, btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // iOS 只在 user gesture 後的極短時間內 focus 才會彈鍵盤
    requestAnimationFrame(() => requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
    }));
}

// BC 自己在送出訊息後也會呼叫 .focus()，那不是使用者點的。只認「使用者剛按過」
// 之後這段時間內的 focusin，否則假輸入框會無故彈出。
let crLastUserGesture = 0;
const CR_GESTURE_WINDOW_MS = 800;

function crHookChatInput() {
    const chatDiv = document.getElementById('chat-room-div');
    if (!chatDiv || chatDiv._lceFakeInputHandler) return;

    const gestureHandler = () => { crLastUserGesture = Date.now(); };
    chatDiv.addEventListener('pointerdown', gestureHandler, true);
    chatDiv.addEventListener('touchstart', gestureHandler, true);

    const handler = (e) => {
        if (!crActive || !isPortrait()) return;
        const el = e.target;
        if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
        if (Date.now() - crLastUserGesture > CR_GESTURE_WINDOW_MS) return;
        e.preventDefault();
        crShowFakeInput(el);
    };
    chatDiv._lceFakeInputHandler = handler;
    chatDiv._lceGestureHandler = gestureHandler;
    chatDiv.addEventListener('focusin', handler, true);
}

function crUnhookChatInput() {
    const chatDiv = document.getElementById('chat-room-div');
    if (!chatDiv || !chatDiv._lceFakeInputHandler) return;
    chatDiv.removeEventListener('focusin', chatDiv._lceFakeInputHandler, true);
    chatDiv.removeEventListener('pointerdown', chatDiv._lceGestureHandler, true);
    chatDiv.removeEventListener('touchstart', chatDiv._lceGestureHandler, true);
    delete chatDiv._lceFakeInputHandler;
    delete chatDiv._lceGestureHandler;
}

/** 每幀維護（由 DrawProcess / ChatRoomResize 呼叫）。 */
export function crMaintain() {
    if (!crActive) return;
    const L = crCalc();
    forceCanvasStyle(L.cvH);
    if (typeof ChatRoomDivRect !== 'undefined') {
        ChatRoomDivRect[0] = 0;
        ChatRoomDivRect[1] = L.cLY;
        ChatRoomDivRect[2] = L.mLW;
        ChatRoomDivRect[3] = L.cLH;
    }
    const fs = typeof ChatRoomFontSize !== 'undefined' ? ChatRoomFontSize : 30;
    positionElement('chat-room-top-menu', fs, 0, L.mLY, L.mLW, L.mLH);
    crHookChatInput();
}

export function crApply() {
    if (crActive) return;
    crActive = true;
    crLockedVH = getLockedVH();
    const L = crCalc();

    injectStyle('lce-v-cr', `
        html, body { overflow-x: hidden !important }
        #chat-room-top-menu { position:fixed !important; z-index:${Z.TOP_MENU} !important }
        #chat-room-div      { position:fixed !important; z-index:${Z.CHAT_DIV} !important }
    `);

    forceCanvasStyle(L.cvH);

    if (!crOrigRect && typeof ChatRoomDivRect !== 'undefined') crOrigRect = [...ChatRoomDivRect];
    if (typeof ChatRoomDivRect !== 'undefined') {
        ChatRoomDivRect[0] = 0;
        ChatRoomDivRect[1] = L.cLY;
        ChatRoomDivRect[2] = L.mLW;
        ChatRoomDivRect[3] = L.cLH;
    }

    requestAnimationFrame(() => {
        crMaintain();
        if (typeof ChatRoomResize === 'function') { try { ChatRoomResize(false); } catch { /* ignore */ } }
        crHookChatInput();
    });
}

export function crRemove() {
    if (!crActive) return;
    crActive = false;
    crLockedVH = 0;
    crFakeInputActive = false;

    document.getElementById('lce-cr-fake-input-overlay')?.remove();
    removeStyle('lce-cr-keyboard-lock');
    crUnhookChatInput();
    clearCanvasStyle();
    removeStyle('lce-v-cr');

    if (crOrigRect && typeof ChatRoomDivRect !== 'undefined') {
        for (let i = 0; i < 4; i++) ChatRoomDivRect[i] = crOrigRect[i];
    }
    crOrigRect = null;

    if (typeof ChatRoomResize === 'function') { try { ChatRoomResize(false); } catch { /* ignore */ } }
}

// ───────────────────────── 對話框（Dialog）─────────────────────────
// 不搬 canvas 的右半，而是「複製」一份到下半螢幕；點擊下半時把螢幕座標換算回
// BC 的虛擬座標，設好 MouseX/MouseY 再 dispatch 事件，讓 BC 自己處理點擊邏輯。

let drActive = false;
let drMirrorRAF = null;
let drCapture = null;

export const isDrActive = () => drActive;

/** 把下半螢幕的點擊換算成 BC 虛擬座標並注入。 */
function drInjectClick(screenX, screenY, pointerType = 'touch') {
    const vw = window.innerWidth;
    const cvH = Math.round(window.innerHeight * 0.5);
    const cv = getCanvas();
    if (!cv) return;
    const rect = cv.getBoundingClientRect();

    // BC 虛擬座標系：右半是 x 1000~2000
    if (typeof MouseX !== 'undefined') window.MouseX = 1000 + (screenX / vw) * 1000;
    if (typeof MouseY !== 'undefined') window.MouseY = (screenY - cvH) / cvH * 1000;

    const eventOpts = {
        bubbles: true, cancelable: true,
        clientX: (vw + screenX) + rect.left,
        clientY: (screenY - cvH) + rect.top,
        pointerType, isPrimary: true,
    };

    if (typeof PointerEvent === 'function') {
        // 合成事件的 pointerId 沒有對應的真實 pointer，setPointerCapture 會丟
        // NotFoundError，先暫時擋掉
        const origSet = cv.setPointerCapture.bind(cv);
        const origRelease = cv.releasePointerCapture.bind(cv);
        cv.setPointerCapture = () => {};
        cv.releasePointerCapture = () => {};
        try {
            cv.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
            cv.dispatchEvent(new PointerEvent('pointerup', eventOpts));
        } finally {
            cv.setPointerCapture = origSet;
            cv.releasePointerCapture = origRelease;
        }
    }

    cv.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    cv.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    cv.dispatchEvent(new MouseEvent('click', eventOpts));

    // 兩幀後歸位，避免殘留座標影響 BC 後續判斷
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (typeof MouseX !== 'undefined') window.MouseX = -1;
        if (typeof MouseY !== 'undefined') window.MouseY = -1;
    }));
}

const DIALOG_SEL = '.dialog-root, #color-picker, #layering';

// 記住每個元素「上次我們設的位置」。BC 沒重新定位它就別再動，否則位移會一直
// 疊加，畫面會漂移抖動。
const drMovedElements = new WeakMap();

/** 每幀把 dialog 頂層容器搬到下半螢幕（只動頂層，子元素相對定位不變）。 */
export function drMoveDomElements() {
    if (!drActive) return;
    const vw = window.innerWidth;
    const cvH = Math.round(window.innerHeight * 0.5);

    document.querySelectorAll(DIALOG_SEL).forEach((el) => {
        const r = el.getBoundingClientRect();
        const prev = drMovedElements.get(el);
        if (prev && Math.abs(r.left - prev.lastSetLeft) < 1 && Math.abs(r.top - prev.lastSetTop) < 1) return;
        if (r.left < vw * 0.5) return;   // 只處理 BC 定位在螢幕右側（被擠出去）的元素

        const newLeft = r.left - vw;
        const newTop = r.top + cvH;
        el.style.setProperty('left', newLeft + 'px', 'important');
        el.style.setProperty('top', newTop + 'px', 'important');
        el.style.setProperty('z-index', String(Z.DIALOG_ROOT), 'important');
        if (el.classList.contains('dialog-root')) el.style.setProperty('width', vw + 'px', 'important');
        drMovedElements.set(el, { lastSetLeft: newLeft, lastSetTop: newTop });
    });
}

/** 建立 mirror canvas，持續把主 canvas 右半複製到下半螢幕（每 2 幀一次，30fps 夠用）。 */
function drStartMirror() {
    const cvH = Math.round(window.innerHeight * 0.5);
    const vw = window.innerWidth;

    document.getElementById('lce-dr-mirror')?.remove();
    if (drMirrorRAF) { cancelAnimationFrame(drMirrorRAF); drMirrorRAF = null; }

    const mirror = document.createElement('canvas');
    mirror.id = 'lce-dr-mirror';
    mirror.width = vw;
    mirror.height = cvH;
    mirror.style.cssText = `
        position:fixed !important; top:${cvH}px !important; left:0 !important;
        width:${vw}px !important; height:${cvH}px !important;
        z-index:${Z.DR_MIRROR} !important; pointer-events:none !important;
    `;
    document.body.appendChild(mirror);

    const ctx = mirror.getContext('2d');
    const src = getCanvas();
    let frame = 0;

    const loop = () => {
        drMirrorRAF = requestAnimationFrame(loop);
        if (!drActive || !src) return;
        if (++frame % 2 === 0) {
            ctx.clearRect(0, 0, vw, cvH);
            try { ctx.drawImage(src, 1000, 0, 1000, 1000, 0, 0, vw, cvH); } catch { /* ignore */ }
        }
        drMoveDomElements();
    };
    loop();
}

export function drApply() {
    if (drActive) return;
    drActive = true;

    const cvH = Math.round(window.innerHeight * 0.5);
    forceCanvasStyle(cvH);

    injectStyle('lce-v-dr', `
        html, body { overflow-x:hidden !important }
        #lce-dr-overlay {
            position:fixed; top:${cvH}px; left:0;
            width:100vw; height:calc(100vh - ${cvH}px);
            z-index:${Z.DR_OVERLAY} !important;
            cursor:pointer; -webkit-tap-highlight-color:transparent; background:transparent;
        }
        .dialog-root { pointer-events:auto !important; overflow-y:auto !important }
    `);

    drStartMirror();

    document.getElementById('lce-dr-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'lce-dr-overlay';

    const onPointer = (e) => {
        if (!drActive) return;
        e.preventDefault();
        e.stopPropagation();
        const x = e.clientX ?? e.changedTouches?.[0]?.clientX;
        const y = e.clientY ?? e.changedTouches?.[0]?.clientY;
        if (x != null && y != null) drInjectClick(x, y, e.type === 'touchstart' ? 'touch' : 'mouse');
    };
    overlay.addEventListener('mousedown', onPointer, { passive: false });
    overlay.addEventListener('touchstart', onPointer, { passive: false });
    document.body.appendChild(overlay);

    drCapture = { overlay, onPointer };
    drMoveDomElements();
}

export function drRemove() {
    if (!drActive) return;
    drActive = false;

    if (drMirrorRAF) { cancelAnimationFrame(drMirrorRAF); drMirrorRAF = null; }
    document.getElementById('lce-dr-mirror')?.remove();

    document.querySelectorAll(DIALOG_SEL).forEach((el) => {
        for (const p of ['left', 'top', 'z-index', 'width']) el.style.removeProperty(p);
        drMovedElements.delete(el);
    });

    clearCanvasStyle();
    removeStyle('lce-v-dr');

    if (drCapture) {
        drCapture.overlay.removeEventListener('mousedown', drCapture.onPointer);
        drCapture.overlay.removeEventListener('touchstart', drCapture.onPointer);
        drCapture.overlay.remove();
        drCapture = null;
    }
}

/** 每幀維護（mirror 由自己的 rAF loop 維持，這裡只顧 canvas）。 */
export function drMaintain() {
    if (!drActive) return;
    forceCanvasStyle(Math.round(window.innerHeight * 0.5));
}

/** 假輸入框樣式。跟著主題走，不像 MPL 寫死深色。 */
export function injectChatRoomStyles() {
    injectStyle('lce-v-cr-base', `
        #lce-cr-fake-input-overlay {
            position:fixed; inset:0; z-index:200;
            background:rgba(0,0,0,0.72);
            display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
            padding-top:18px;
        }
        .lce-cr-fake-box {
            width:92%; max-width:520px;
            background:var(--lce-element, #1a1a2e);
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            border-radius:14px; padding:12px 14px;
            display:flex; flex-direction:column; gap:10px;
        }
        .lce-cr-fake-title { color:var(--lce-text, #fff); opacity:0.55; font-size:12px }
        .lce-cr-fake-ta {
            width:100%; box-sizing:border-box;
            background:var(--lce-element-hover, rgba(255,255,255,0.08));
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            border-radius:9px; color:var(--lce-text, #fff); font-size:15px;
            padding:10px 12px; outline:none; resize:none; font-family:inherit; line-height:1.5;
        }
        .lce-cr-fake-btnrow { display:flex; gap:8px; justify-content:flex-end }
        .lce-cr-fake-btn {
            padding:8px 20px; border-radius:8px;
            border:1px solid var(--lce-accent, rgba(255,255,255,0.18));
            background:var(--lce-element-hover, rgba(255,255,255,0.07));
            color:var(--lce-text, #fff); font-size:14px; cursor:pointer;
        }
        .lce-cr-fake-btn-send {
            background:var(--lce-main, rgba(80,60,200,0.40));
            font-weight:700;
        }
    `);
}

export function removeChatRoomStyles() { removeStyle('lce-v-cr-base'); }

export { LOG };
