// ════════════════════════════════════════════════════════════════════════════
// 慾望成長增幅（arousalGrowthAmount）
//
// 規格：0~100，每次成長時比原本成長得更多，100 = 原本的 10 倍。
//   倍率 = 1 + (值 / 100) * 9  →  0=1 倍（等同原版）、50=5.5 倍、100=10 倍
//
// 做法：hook BC 的 ActivityTimerProgress(C, Progress) —— 所有慾望增減都會經過這裡，
// 只放大「正的」成長量（不影響衰退），且只作用於自己（別人的慾望是由對方同步過來的）。
//
// 註：WCE 的 alternateArousal 是「整套替換慾望演算法」（大量 patchFunction 字串替換、
// 極度依賴 BC 版本），與這裡的規格不同，故不移植。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';

/** 目前的成長倍率；未啟用或值無效時回傳 1（等同原版）。 */
export function growthFactor() {
    if (!getFeature('arousalGrowthAmountEnabled')) return 1;
    const raw = parseFloat(getFeature('arousalGrowthAmount'));
    if (!Number.isFinite(raw)) return 1;
    const amount = Math.max(0, Math.min(100, raw));
    return 1 + (amount / 100) * 9;
}

let installed = false;

export function installArousal() {
    if (installed) return;
    installed = true;

    try {
        modApi.hookFunction('ActivityTimerProgress', 10, (args, next) => {
            const [C, progress] = args;
            if (C?.IsPlayer?.() && typeof progress === 'number' && progress > 0) {
                const f = growthFactor();
                if (f !== 1) args[1] = progress * f;
            }
            return next(args);
        });
    } catch (e) {
        console.warn(LOG, '慾望成長增幅 hook 未掛上:', e?.message ?? e);
    }
}
