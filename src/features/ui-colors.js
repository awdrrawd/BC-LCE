// ════════════════════════════════════════════════════════════════════════════
// LCE 介面配色（ui 分類的 5 個顏色設定）
//
// 這裡染的是「LCE 自己畫出來的東西」：登入介面、系統訊息、通知氣球。
// 跟 features/theme.js（BC 主題）是兩回事 —— 那邊接管 BC 本體的繪圖，
// 這邊只是把幾個顏色灌成 CSS 變數，所以 BC 主題關著也照樣有效。
//
// 為什麼要有 -rgb 版本的變數：邊框、陰影、hover 底色都需要「同一個顏色的不同透明度」。
// CSS 變數存 #rrggbb 的話沒辦法直接加 alpha，所以額外提供 "r,g,b" 讓樣式寫
// rgba(var(--lce-login-accent-rgb), 0.5)。（color-mix 也能做，但相容性差一截。）
//
// ui 是全域分類（見 settings-schema 的 GLOBAL_CATEGORIES），登入前就讀得到，
// 所以登入頁也能套色。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../core/feature-settings.js';
import { DEFAULT_FEATURE_SETTINGS } from '../core/settings-schema.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { injectStyle } from '../core/util.js';

const STYLE_ID = 'lce-ui-colors';

/**
 * 這些鍵一變就要重套色。
 * 註：tooltipBgColor / tooltipTextColor 不在這裡 —— 設定頁的說明框是 canvas 繪製，
 * 吃不到 CSS 變數，由 settings/settings-page.js 每幀自己讀。
 */
const COLOR_KEYS = [
    'loginAccentColor', 'sysMsgBgColor', 'sysMsgTextColor', 'commanderBtnColor',
    'notifyBubbleColor', 'notifyBubbleTextColor',
];

/** 讀色票；值壞掉（使用者手動填了非色碼）時退回 schema 預設，不讓整張樣式表爆掉。 */
function color(key) {
    const v = getFeature(key);
    if (typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v)) return v;
    return DEFAULT_FEATURE_SETTINGS[key]?.value ?? '#000000';
}

/** '#7214ff' → '114,20,255'（供 rgba() 加透明度用）。也吃 #abc 這種縮寫。 */
function toRgbParts(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** 依目前設定重新注入配色變數。設定改了就再呼叫一次即可。 */
export function applyUiColors() {
    const accent = color('loginAccentColor');
    const sysBg = color('sysMsgBgColor');
    const sysText = color('sysMsgTextColor');
    const cmdBtn = color('commanderBtnColor');
    const bubbleBg = color('notifyBubbleColor');
    const bubbleText = color('notifyBubbleTextColor');

    injectStyle(STYLE_ID, `
:root {
    --lce-login-accent: ${accent};
    --lce-login-accent-rgb: ${toRgbParts(accent)};
    --lce-sysmsg-bg: ${sysBg};
    --lce-sysmsg-text: ${sysText};
    --lce-cmd-btn: ${cmdBtn};
}
/* BC 的通知氣球（ServerShowBeep → ToastManager.info → .toast.info）
   讀的是 .toast-container 上的這兩個變數，見 BC 的 CSS/toasts.css。
   蓋在容器上就好，不必自己去追每一顆 toast 節點。 */
.toast-container {
    --bg-info: ${bubbleBg};
    --accent-info: ${bubbleText};
}
    `);
}

/**
 * 拖曳調色盤時的即時預覽：只改 documentElement 的 inline 變數，不存檔。
 * （調色盤的 input 事件會隨滑鼠連發，每次都 setFeature 等於狂寫 localStorage。）
 * inline style 的優先級高於注入樣式表的 :root，所以預覽期間畫面吃的是這個值。
 */
export function previewLoginAccent(hex) {
    if (!/^#([0-9a-fA-F]{6})$/.test(hex)) return;
    const el = document.documentElement;
    el.style.setProperty('--lce-login-accent', hex);
    el.style.setProperty('--lce-login-accent-rgb', toRgbParts(hex));
}

/**
 * 收掉預覽用的 inline 變數，把主導權交回樣式表。
 * 定案（setFeature）之後一定要呼叫，否則 inline 值會一直壓著，
 * 之後從遊戲內設定頁改色會看起來完全沒反應。
 */
export function clearLoginAccentPreview() {
    const el = document.documentElement;
    el.style.removeProperty('--lce-login-accent');
    el.style.removeProperty('--lce-login-accent-rgb');
}

let installed = false;

export function installUiColors() {
    if (installed) return;
    installed = true;
    applyUiColors();
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (COLOR_KEYS.includes(e.detail?.key)) applyUiColors();
    });
}
