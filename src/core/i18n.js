// ════════════════════════════════════════════════════════════════════════════
// i18n（依 BC 語言選擇字表）
//
// 字表是 LCE 自己的 —— 別的插件的字庫裡沒有我們的鍵，這部分共用不了。
// 每個語系一個獨立語系包，放在專案根目錄的 Translation/<code>.js —— 抽到根目錄是為了
// 讓只想改翻譯、不熟程式結構的人容易找到、容易改。完整字表、登入頁+設定頁已合併。
//
// 「現在是什麼語言」的判斷走 window.Liko.I18N 這個共用註冊處：誰先載入誰建立，
// 之後所有 Liko 插件共用同一套語言判斷與切換通知。見 core/i18n-registry.js。
// ════════════════════════════════════════════════════════════════════════════

import { getSharedI18n } from './i18n-registry.js';
import twTable from '../../Translation/tw.js';
import cnTable from '../../Translation/cn.js';
import enTable from '../../Translation/en.js';
import deTable from '../../Translation/de.js';
import frTable from '../../Translation/fr.js';
import ruTable from '../../Translation/ru.js';
import uaTable from '../../Translation/ua.js';

// 鍵一律用正規化語系碼（TW/CN/EN/DE/FR/RU/UA），與 i18n-registry 的 normalize()
// 以及對外 register() 一致 —— 內外命名同一套，不用再做映射。
const I18N = {
    TW: twTable, CN: cnTable, EN: enTable,
    DE: deTable, FR: frTable, RU: ruTable, UA: uaTable,
};

// ── 共用註冊處 ────────────────────────────────────────────────────────────
// 字表還是我們自己的（別人的字庫沒有我們的鍵），共用的只有「現在是什麼語言」
// 這套判斷。詳見 core/i18n-registry.js 的說明。
const NAMESPACE = 'LCE';
const shared = getSharedI18n();
if (shared) {
    shared.register(NAMESPACE, I18N);
    // 語言被切換時把畫面上帶 i18n 標記的節點重刷一次
    shared.onChange(() => { try { refreshI18n(); } catch { /* ignore */ } });
}

/**
 * 後備路徑（沒有共用註冊處時才用）：讀 BC 語言碼，有對應字表就用，其餘退回 EN。
 * 正常情況走 shared.t()，語言碼由 i18n-registry 的 normalize() 統一（含 UK→UA 等別名）。
 */
function getLang() {
    const code = (typeof TranslationLanguage !== 'undefined' && TranslationLanguage)
        || localStorage.getItem('BondageClubLanguage') || 'EN';
    return I18N[code] ? code : 'EN';
}

/**
 * 翻譯函式：找不到 key 時回傳 key 本身。
 * 有共用註冊處就走它（語言判斷跟其他 Liko 插件一致），沒有就用自己的字庫。
 */
export function T(key) {
    if (shared) return shared.t(NAMESPACE, key);
    const table = I18N[getLang()] || I18N.EN;
    return table[key] ?? I18N.EN[key] ?? key;
}

/** 標記元素的 i18n key，供語言切換後即時重刷 */
export function i18nText(el, key) { el.textContent = T(key); el.dataset.lceKey = key; }
export function i18nPlaceholder(el, key) { el.setAttribute('placeholder', T(key)); el.dataset.lcePhKey = key; }

/** 重刷所有帶 i18n 標記的節點 */
export function refreshI18n() {
    document.querySelectorAll('[data-lce-key]').forEach(el => { el.textContent = T(el.dataset.lceKey); });
    document.querySelectorAll('[data-lce-ph-key]').forEach(el => { el.setAttribute('placeholder', T(el.dataset.lcePhKey)); });
}
