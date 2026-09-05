// ════════════════════════════════════════════════════════════════════════════
// 頭頂徽章
//
// 徽章的用途是「一眼看出對方裝了什麼」。沒有它，/versions 就形同虛設 ——
// 你得先知道對方有裝，才會想去查；不知道就不會查，那查得到也沒意義。
//
// 兩種徽章，資料由 features/hello.js 寫進角色物件：
//   WCE / FBC ← character.FBC   （沒有 lce 標記的 BCEMsg）
//   LCE       ← character.LCE   （夾了 lce 標記的 BCEMsg，或舊版 LCEMsg）
// 兩者都走 WCE 的 BCEMsg 頻道，靠 payload 裡的 lce 標記區分（見 hello.js 的說明）。
//
// ── 只裝一個 → 正常顯示該枚；兩個都裝 → 只顯示 LCE，並讓它「每 3 秒換一個顏色」──
// 同時裝 WCE + LCE 時只畫一枚 LCE 徽章（省掉頭上兩排字），但把它做成循環變色，
// 一眼就能和「只裝 LCE」的純白徽章區分開來 —— 看到會變色 = 對方兩個都裝。
// 本地若也裝了 WCE，WCE 會用自己的 hook 畫 WCE 徽章；我們在呼叫 next 前暫時藏起
// C.FBC 讓它畫不出來（見下方 hook），next 回來再還原。
//
// 位置、字級、配色與 WCE 的 chatRoomOverlay.ts 一致，兩邊看到的畫面才對得起來。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../../modsdk.js';

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
            const C = args[0];
            // 對方同時裝了 WCE + LCE：若本地也有 WCE，它會在 next 內用自己的 hook 畫 WCE 徽章。
            // 呼叫 next 前暫時藏起 C.FBC 讓它看不到、不畫；next 回來後還原，改由我們只畫一枚
            // 會變色的 LCE 徽章（見 drawBadge 的「兩者都裝」分支）。
            const both = !!(C && C.FBC && C.LCE);
            let stashedFBC;
            if (both) { stashedFBC = C.FBC; try { delete C.FBC; } catch { /* ignore */ } }
            let ret;
            try { ret = next(args); }
            finally { if (both) C.FBC = stashedFBC; }
            try { drawBadge(args); } catch { /* 畫不出來就算了，不能拖累聊天室繪製 */ }
            return ret;
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomDrawCharacterStatusIcons hook 未掛上，徽章停用:', e?.message ?? e);
    }
}

// 兩者都裝時 LCE 徽章的循環色盤：每 3 秒取下一個色碼。BC 聊天室每幀重繪，
// 顏色會隨時間自動更新，不需另外開計時器。
const CYCLE_COLORS = ['#ff5555', '#ff9f43', '#ffe14d', '#55e06a', '#4dd2ff', '#6a8cff', '#c86bff'];
const cyclingColor = () => CYCLE_COLORS[Math.floor(Date.now() / 3000) % CYCLE_COLORS.length];

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
 * @param {string} [labelColor] 指定標記顏色（兩者都裝時傳循環色）；省略則沿用備註/白色
 */
function drawOne(label, version, slot, CharX, CharY, Zoom, note, labelColor) {
    const y = CharY + (SLOT_Y + slot * SLOT_H) * Zoom;
    DrawTextFit(label, CharX + BADGE_X * Zoom, y, 60 * Zoom, labelColor || (note ? 'Cyan' : 'White'), 'Black');

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

    // 兩者都裝：只畫一枚 LCE，並用循環色標示（區分於「只裝 LCE」的純白徽章）。
    // WCE 那枚已在 hook 內藏起 C.FBC 讓 WCE 自己不畫，這裡也不補。
    if (C.FBC && C.LCE) {
        drawOne('LCE', C.LCE, slot++, CharX, CharY, Zoom, note, cyclingColor());
        return;
    }

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
