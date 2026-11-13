// ════════════════════════════════════════════════════════════════════════════
// 頭頂徽章
//
// 徽章的用途是「一眼看出對方裝了什麼」。沒有它，/versions 就形同虛設 ——
// 你得先知道對方有裝，才會想去查；不知道就不會查，那查得到也沒意義。
//
// 兩種徽章，資料由 social/hello.js 寫進角色物件：
//   WCE / FBC ← character.FBC   （沒有 lce 標記的 BCEMsg）
//   LCE       ← character.LCE   （夾了 lce 標記的 BCEMsg，或舊版 LCEMsg）
// 兩者都走 WCE 的 BCEMsg 頻道，靠 payload 裡的 lce 標記區分（見 hello.js 的說明）。
//
// 只裝一個：白色／有私人筆記時藍色；兩個都裝：紅色／有私人筆記時紫色。
// 同時裝 WCE + LCE 時只畫一枚 LCE 徽章，版本號保留原本配色。
// 本地若也裝了 WCE，WCE 會用自己的 hook 畫 WCE 徽章；我們在呼叫 next 前暫時藏起
// C.FBC 讓它畫不出來（見下方 hook），next 回來再還原。
//
// 位置、字級、配色與 WCE 的 chatRoomOverlay.ts 一致，兩邊看到的畫面才對得起來。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../../modsdk.js';
import { LOG } from '../../core/constants.js';


let installed = false;

export function installBadges() {
    if (installed) return;
    installed = true;

    try {
        modApi.hookFunction('ChatRoomDrawCharacterStatusIcons', 10, (args, next) => {
            const C = args[0];
            // 統一由 LCE 上色，避免本地 WCE 畫出重複或青色的徽章。
            const hasFbc = !!C?.FBC;
            let stashedFBC;
            if (hasFbc) { stashedFBC = C.FBC; try { delete C.FBC; } catch { /* ignore */ } }
            let ret;
            try { ret = next(args); }
            finally { if (hasFbc) C.FBC = stashedFBC; }
            try { drawBadge(args); } catch { /* 畫不出來就算了，不能拖累聊天室繪製 */ }
            return ret;
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomDrawCharacterStatusIcons hook 未掛上，徽章停用:', e?.message ?? e);
    }
}

// 每個角色只畫一枚徽章，版本號顯示在標記下方。
const SLOT_Y = 14;
const VERSION_DY = 22;
const BADGE_X = 290;

/**
 * 畫一枚徽章。
 * @param {string} label   顯示的標記（WCE / FBC / LCE）
 * @param {string} version 對方報上來的版本字串
 * @param {string} labelColor 徽章文字顏色
 */
function drawOne(label, version, CharX, CharY, Zoom, labelColor) {
    const y = CharY + SLOT_Y * Zoom;
    DrawTextFit(label, CharX + BADGE_X * Zoom, y, 60 * Zoom, labelColor, 'Black');

    // 版本號只在格式正常時顯示；結尾 b = beta，用粉色標出來
    const text = /^\d+\.\d+(\.\d+)?b?$/u.test(version) ? version.replace('b', '') : '';
    DrawTextFit(text, CharX + BADGE_X * Zoom, y + VERSION_DY * Zoom,
        version.split('.').length === 3 ? 60 * Zoom : 40 * Zoom,
        version.endsWith('b') ? 'Lightpink' : 'White', 'Black');
}

function drawBadge([C, CharX, CharY, Zoom]) {
    if (!C) return;
    if (typeof CharX !== 'number' || typeof CharY !== 'number' || typeof Zoom !== 'number') return;
    // BC 的「隱藏圖示」狀態：使用者要求乾淨畫面時，我們也跟著收起來
    if (typeof ChatRoomHideIconState !== 'undefined' && ChatRoomHideIconState !== 0) return;

    // FBCNoteExists 由 social/note-state.js 寫入
    const note = !!C.FBCNoteExists;
    if (C.BCLite === true) {
        DrawTextFit('Lite', CharX + BADGE_X * Zoom, CharY + SLOT_Y * Zoom, 60 * Zoom, note ? 'Cyan' : 'White', 'Black');
        return;
    }

    const both = !!(C.FBC && C.LCE);
    const color = both ? (note ? 'Purple' : 'Red') : (note ? 'Blue' : 'White');
    if (C.LCE) drawOne('LCE', C.LCE, CharX, CharY, Zoom, color);
    else if (C.FBC) {
        const label = ['1', '2', '3', '4', '5'].includes(C.FBC.split('.')[0]) ? 'FBC' : 'WCE';
        drawOne(label, C.FBC, CharX, CharY, Zoom, color);
    }
}
