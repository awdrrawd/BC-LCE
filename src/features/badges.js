// ════════════════════════════════════════════════════════════════════════════
// 頭頂徽章
//
// 徽章的用途是「一眼看出對方裝了什麼」。沒有它，/versions 就形同虛設 ——
// 你得先知道對方有裝，才會想去查；不知道就不會查，那查得到也沒意義。
//
// 兩種徽章，資料來自 features/hello.js 的兩個頻道：
//   WCE / FBC ← character.FBC   （BCEMsg，我們只收不送）
//   LCE       ← character.LCE   （LCEMsg，LCE 自己的頻道）
//
// 兩個都有 = 對方同時裝了 WCE 和 LCE，兩枚都畫，由 slot 往下疊，不會重疊。
// 裝了 WCE 時第 0 格讓給它自己畫（見 wceDrawsItself），我們只補 LCE 那枚。
//
// 位置、字級、配色與 WCE 的 chatRoomOverlay.ts 一致，兩邊看到的畫面才對得起來。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';

const LOG = '🐈‍⬛ [LCE]';

/**
 * WCE 自己載入時會設 globalThis.FBC_VERSION（見 WCE src/index.ts）。
 * 有它就代表 WCE 會自己畫徽章，我們再畫一次會變成兩層疊字。
 * 每次繪製都查而不是啟動時查一次 —— 載入順序不保證，WCE 可能比我們晚到。
 */
const wceDrawsItself = () => typeof globalThis.FBC_VERSION !== 'undefined';

let installed = false;

export function installBadges() {
    if (installed) return;
    installed = true;

    try {
        modApi.hookFunction('ChatRoomDrawCharacterStatusIcons', 10, (args, next) => {
            const ret = next(args);
            try { drawBadge(args); } catch { /* 畫不出來就算了，不能拖累聊天室繪製 */ }
            return ret;
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomDrawCharacterStatusIcons hook 未掛上，徽章停用:', e?.message ?? e);
    }
}

// 一枚徽章 = 標記 + 版本號兩行。WCE 用的是 +14 / +36，所以一格高 44。
const SLOT_Y = 14;
const SLOT_H = 44;
const VERSION_DY = 22;
const BADGE_X = 290;

/**
 * 畫一枚徽章。
 * @param {string} label   顯示的標記（WCE / FBC / LCE）
 * @param {string} version 對方報上來的版本字串
 * @param {number} slot    第幾格（0 = 最上面），往下疊
 * @param {boolean} note   對方是否有備註（有 → 標青色，同 WCE）
 */
function drawOne(label, version, slot, CharX, CharY, Zoom, note) {
    const y = CharY + (SLOT_Y + slot * SLOT_H) * Zoom;
    DrawTextFit(label, CharX + BADGE_X * Zoom, y, 60 * Zoom, note ? 'Cyan' : 'White', 'Black');

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

    // FBCNoteExists 由 features/past-profiles.js 寫入
    const note = !!C.FBCNoteExists;
    let slot = 0;

    if (C.FBC) {
        if (wceDrawsItself()) {
            // WCE 會自己把第 0 格畫掉，我們只是讓位，免得兩層字疊在一起
            slot++;
        } else {
            // 主版號 1~5 是舊的 FBC，之後才更名為 WCE
            const label = ['1', '2', '3', '4', '5'].includes(C.FBC.split('.')[0]) ? 'FBC' : 'WCE';
            drawOne(label, C.FBC, slot++, CharX, CharY, Zoom, note);
        }
    }

    if (C.LCE) drawOne('LCE', C.LCE, slot++, CharX, CharY, Zoom, note);
}
