// ════════════════════════════════════════════════════════════════════════════
// BC 原生 / 第三方 UI 隱藏 + FUSAM 透傳
// ════════════════════════════════════════════════════════════════════════════

import { BC_HIDE_IDS, BC_PASSTHROUGH_IDS, THIRD_PARTY_HIDE_CSS, Z } from '../core/constants.js';
import { S } from '../core/state.js';
import { injectStyle, removeStyle } from '../core/util.js';

/**
 * 隱藏 BC 原生登入 HTML（保留 canvas —— canvas 由滿版背景圖蓋住，但仍需其幾何供座標對齊），
 * 並遮蔽第三方登入元素（Themed 的登入選項按鈕），確保 FUSAM 可見。
 */
export function hideBC() {
    BC_HIDE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display', 'none', 'important');
    });
    // 用 CSS 規則遮蔽第三方元素——即使它們稍後才建立也會被套用（點5）
    injectStyle('lce-hide-thirdparty', THIRD_PARTY_HIDE_CSS);
    ensureFusamVisible();
}

/** 還原 BC 原生登入 HTML，清除第三方遮蔽與 FUSAM override */
export function showBC() {
    BC_HIDE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.removeProperty('display');
    });
    removeStyle('lce-hide-thirdparty');
    BC_PASSTHROUGH_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.removeProperty('z-index');
    });
    if (S.fusamObserver) { S.fusamObserver.disconnect(); S.fusamObserver = null; }
}

/**
 * 確保 FUSAM 元素在 LCE 之上、可點擊。
 * stage 用 pointer-events:none（只有面板/按鈕才 auto），本來就不太會蓋到 fusam 按鈕，
 * 但仍把 fusam 的 z-index 拉高以保險。展開後的 UI 尺寸不處理（橫向畫面夠大）。
 */
export function ensureFusamVisible() {
    BC_PASSTHROUGH_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('z-index', String(Z.FUSAM), 'important');
    });
    if (!document.getElementById('fusam-show-button') && !S.fusamObserver && S.active) {
        S.fusamObserver = new MutationObserver(() => {
            if (!S.active) return;
            BC_PASSTHROUGH_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.setProperty('z-index', String(Z.FUSAM), 'important');
            });
        });
        S.fusamObserver.observe(document.body, { childList: true, subtree: true });
    }
}
