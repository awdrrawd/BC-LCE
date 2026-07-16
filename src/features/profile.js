// ════════════════════════════════════════════════════════════════════════════
// 個人資料（BIO）
//   richOnlineProfile  ：把 BIO 顯示成可點連結／內嵌圖片的唯讀檢視（移植 WCE）
//   profileEditProtect ：BIO 預設不可編輯，按下編輯鈕才解鎖，避免誤改
//
// 兩者共用「同一顆切換鈕」（位置/圖示同 WCE）：
//   檢視狀態 = 富文本唯讀檢視（richOnlineProfile 開）或唯讀輸入框（僅 profileEditProtect 開）
//   編輯狀態 = BC 原生輸入框，可編輯
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { positionElement } from '../core/util.js';
import { processChatAugmentsForLine } from './chat-augments.js';

const TA_ID = 'DescriptionInput';        // BC 的 BIO 輸入框
const RICH_ID = 'lceRichOnlineProfile';  // 我們的唯讀富文本檢視
const BTN = [90, 60, 90, 90];            // 與 WCE 相同的切換鈕位置

let editing = false;                     // false = 檢視/保護中

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn('🐈‍⬛ [LCE] profile hook 未掛上:', name, e?.message ?? e); }
}

const richOn = () => !!getFeature('richOnlineProfile');
const protectOn = () => !!getFeature('profileEditProtect');
const anyOn = () => richOn() || protectOn();

// ───────────────────────── 唯讀輸入框（保護） ─────────────────────────
function setReadOnly(on) {
    const ta = document.getElementById(TA_ID);
    if (!ta) return;
    ta.readOnly = on;
    ta.style.opacity = on ? '0.9' : '';
}

// ───────────────────────── 富文本檢視 ─────────────────────────
function profileText() {
    return OnlineProfileMode === 'Description' ? OnlineProfileTextDesc : OnlineProfileTextOwnersNotes;
}

function showTextArea(show) {
    const ta = document.getElementById(TA_ID);
    if (ta) ta.style.display = show ? '' : 'none';
}

function resizeRich() {
    positionElement(RICH_ID, 36, 100, 160, 1790, 750);
}

function enableRich() {
    showTextArea(false);
    let div = document.getElementById(RICH_ID);
    if (!div) {
        div = document.createElement('div');
        div.id = RICH_ID;
        div.classList.add('lce-rich-textarea');
        document.body.append(div);
    }
    div.textContent = profileText();
    processChatAugmentsForLine(div, () => false);
    resizeRich();
}

function disableRich() {
    document.getElementById(RICH_ID)?.remove();
    showTextArea(true);
}

/** 進入檢視（唯讀）狀態。 */
function enterViewMode() {
    editing = false;
    if (richOn()) enableRich();
    else if (protectOn()) { disableRich(); setReadOnly(true); }
}

/** 進入編輯狀態。 */
function enterEditMode() {
    editing = true;
    disableRich();
    setReadOnly(false);
}

function cleanup() {
    editing = false;
    disableRich();
    setReadOnly(false);
}

let installed = false;

export function installProfile() {
    if (installed) return;
    installed = true;

    hook('OnlineProfileLoad', 10, (args, next) => {
        const ret = next(args);
        try { if (anyOn()) enterViewMode(); } catch (e) { console.warn('🐈‍⬛ [LCE]', e); }
        return ret;
    });

    hook('OnlineProfileRun', 10, (args, next) => {
        if (!anyOn()) return next(args);
        DrawButton(...BTN, '', 'White', 'Icons/Crafting.png', T(editing ? 'profile_edit_on' : 'profile_edit_off'));
        const ret = next(args);
        // BC 每幀可能重建元素，維持目前狀態
        try {
            if (!editing) {
                if (richOn()) { showTextArea(false); resizeRich(); }
                else if (protectOn()) setReadOnly(true);
            }
        } catch { /* ignore */ }
        return ret;
    });

    hook('OnlineProfileClick', 10, (args, next) => {
        if (!anyOn()) return next(args);
        if (MouseIn(...BTN)) {
            if (editing) enterViewMode(); else enterEditMode();
            return true;
        }
        const ret = next(args);
        // 切換 Description / Owner notes 後刷新富文本內容
        try {
            if (!editing && richOn() && MouseIn(1620, 60, 90, 90)) {
                const div = document.getElementById(RICH_ID);
                if (div) { div.textContent = profileText(); processChatAugmentsForLine(div, () => false); }
            }
        } catch { /* ignore */ }
        return ret;
    });

    hook('OnlineProfileUnload', 10, (args, next) => { cleanup(); return next(args); });
    // 離開聊天室畫面時 BC 會清元素，順手移除富文本層
    hook('ChatRoomHideElements', 10, (args, next) => { disableRich(); return next(args); });
}
