// ════════════════════════════════════════════════════════════════════════════
// 隱藏興奮條（hideArousalMeter）—— 移植自 Hotfix - Hidden Arousal (HHA)
//
// 修復造訪衣櫃/檔案時興奮條異常殘留，並一併隱藏其他模組掛在 DrawArousalMeter 上的
// 附加 HUD（例如 MPA 的寵物狀態球）。適用三個畫面：Appearance / InformationSheet /
// ChatRoom（且正開著某角色的對話框）。
//
// priority 設高（10），確保比 MPA（priority:1）等任何掛在 DrawArousalMeter 上的模組
// 都更「外層」：一旦判定要隱藏，直接不呼叫 next()，整條 hook 鏈（含 MPA 自己的邏輯）
// 全部跳過，三個畫面統一生效。無條件掛 hook，執行時才看設定。預設關閉。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';

function shouldHide() {
    try {
        const s = CurrentScreen;
        if (s === 'Appearance')       return true;
        if (s === 'InformationSheet') return true;
        if (s === 'ChatRoom'
            && typeof CurrentCharacter !== 'undefined'
            && CurrentCharacter !== null) return true;
    } catch { /* ignore */ }
    return false;
}

let installed = false;

export function installHiddenArousal() {
    if (installed) return;
    installed = true;

    try {
        modApi.hookFunction('DrawArousalMeter', 10, (args, next) => {
            // 不呼叫 next → 內建興奮條 + 其他模組附加 HUD 全部跳過。
            if (getFeature('hideArousalMeter') && shouldHide()) return;
            return next(args);
        });
    } catch (e) {
        console.warn(LOG, 'Hidden arousal hook 未掛上（此 BC 版本可能沒有 DrawArousalMeter）:', e?.message ?? e);
    }
}
