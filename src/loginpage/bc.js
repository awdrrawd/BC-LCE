// ════════════════════════════════════════════════════════════════════════════
// BC 原生 / 第三方 UI 隱藏 + 外掛管理器透傳
// ════════════════════════════════════════════════════════════════════════════

import { BC_HIDE_IDS, BC_PASSTHROUGH_IDS, THIRD_PARTY_HIDE_CSS, Z } from '../core/constants.js';
import { injectStyle, removeStyle } from '../core/util.js';

// FUSAM 的插件管理器（#fusam-addon-manager-container）是「點開才建立」的，插件管理器面板
// 展開時 z-index 若沒被拉高，就會被 LCE 的登入頁 / 遊戲內浮層蓋住 —— 這是「LCE 遮到 FUSAM
// 設定頁」的成因。舊作法用 inline style + MutationObserver：面板尚未存在時第一次 forEach 抓不到，
// 而 observer 又在「fusam-show-button 已存在」時被跳過不建立，於是之後才展開的面板永遠沒被拉高。
//
// 改用一條「常駐的全域 CSS 規則」：規則會自動套用到之後才建立、甚至被 FUSAM 重建的元素上，
// 不需要 observer 也不受建立時序影響；全域常駐（不分登入或遊戲內）也讓管理器在兩種情境都蓋過
// 一般 LCE 浮層。z-index 使用 Z.ADDON_MANAGER，高於登入 stage、設定頁與遊戲內一般浮層。
const ADDON_MANAGER_TOP_STYLE_ID = 'lce-addon-manager-top';
const ADDON_MANAGER_TOP_CSS = `${BC_PASSTHROUGH_IDS.map(id => `#${id}`).join(',')}{z-index:${Z.ADDON_MANAGER} !important}`;

/** 注入常駐規則，確保 FUSAM／PCM 管理器永遠疊在 LCE 之上。可重複呼叫。 */
export function ensureAddonManagersVisible() {
    injectStyle(ADDON_MANAGER_TOP_STYLE_ID, ADDON_MANAGER_TOP_CSS);
}

// 舊名稱保留給可能引用此模組的既有 LCE 程式。
export const ensureFusamVisible = ensureAddonManagersVisible;

/**
 * 隱藏 BC 原生登入 HTML（保留 canvas —— canvas 由滿版背景圖蓋住，但仍需其幾何供座標對齊），
 * 並遮蔽第三方登入元素（Themed 的登入選項按鈕），確保外掛管理器可見。
 */
export function hideBC() {
    BC_HIDE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display', 'none', 'important');
    });
    // 用 CSS 規則遮蔽第三方元素——即使它們稍後才建立也會被套用（點5）
    injectStyle('lce-hide-thirdparty', THIRD_PARTY_HIDE_CSS);
    ensureAddonManagersVisible();
}

/** 還原 BC 原生登入 HTML，清除第三方遮蔽。
 *  外掛管理器置頂規則是常駐的（遊戲內也要生效），故意不在這裡移除。 */
export function showBC() {
    BC_HIDE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.removeProperty('display');
    });
    removeStyle('lce-hide-thirdparty');
}
