// ════════════════════════════════════════════════════════════════════════════
// 常數集中管理
// ════════════════════════════════════════════════════════════════════════════

/* global __LCE_VERSION__ */
// 版本號由 Vite 的 define 於建置時注入（見 vite.config.js）；未定義時 fallback。
export const MOD_VER = (typeof __LCE_VERSION__ !== 'undefined' ? __LCE_VERSION__ : '0.1.0');

// BC 內部 canvas 邏輯座標尺寸（我們的版面座標系與此一致）
export const CANVAS_W = 2000;
export const CANVAS_H = 1000;

// 資源基底 URL（用於載入背景圖）
export const BASE_URL = (() => {
    const href = window.location.href;
    return href.includes('/') ? href.slice(0, href.lastIndexOf('/') + 1) : href + '/';
})();

// 與 MPL 共用的儲存 key —— 帳號、頭像、金鑰都存在同一處，兩個插件雙向共用。
export const ACCT_KEY      = 'mpl_accounts';   // localStorage：帳號清單
export const IDB_NAME      = 'mpl-profiles';   // IndexedDB 資料庫
export const IDB_STORE     = 'profiles';       // 角色快照 ObjectStore
export const IDB_KEY_STORE = 'cryptokeys';     // AES-GCM 金鑰 ObjectStore

// LCE 專屬設定（不與 MPL 共用）
export const SETTINGS_KEY = 'lce_settings';

/**
 * z-index 分層。stage 疊在 canvas 之上、fusam 之下；設定浮層蓋過 stage；fusam 蓋過一切。
 */
export const Z = {
    STAGE:    100,
    SETTINGS: 400,
    FUSAM:    1000,
};

// 進入 LCE 登入模式時要隱藏的 BC 原生登入元素（不含 MainCanvas —— 保留 canvas 供座標對齊）
export const BC_HIDE_IDS = [
    'InputName', 'InputPassword',
    'login-name-label', 'login-password-label',
    'login-welcome-message', 'login-status',
    'login-login-button', 'login-new-character-label',
    'login-register-button', 'login-password-reset-button',
    'login-password-reset-hint', 'login-cheats-button',
    'login-footer', 'LanguageDropdown',
];

// 需要維持可見的第三方插件元素（FUSAM）
export const BC_PASSTHROUGH_IDS = ['fusam-show-button', 'fusam-addon-manager-container'];

// 第三方插件在登入頁加的 HTML 元素（Themed-BC 的登入選項按鈕/彈窗）——LCE 啟用時遮蔽。
// WCE 的「存檔登入」是直接畫在 MainCanvas 上，會被滿版背景圖蓋住，不需另外處理。
export const THIRD_PARTY_HIDE_CSS =
    '#tmd-login-options-open,#tmd-login-options-dialog{display:none !important}';

// 預設設定
export const DEFAULT_SETTINGS = {
    enhance:      true,      // 1. 登入介面增強（預設啟用）
    showAvatar:   true,      // 2a. 顯示頭像（預設啟用）
    showAccount:  true,      // 2b. 顯示帳號（預設啟用）
    showName:     true,      // 2c. 顯示名稱（預設啟用）
    bgMode:       'random',  // 3. 背景：'random' | 'select'（預設隨機）
    bgName:       'BG-01',   // bgMode='select' 時使用的背景名稱（Images/ 內的檔名，去副檔名）
};

// 內嵌 SVG 圖示（點2）：人形＝帳號、鎖＝密碼
export const ICON_PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4.2"/><path d="M4 21c0-4.2 3.8-6.4 8-6.4s8 2.2 8 6.4"/></svg>';
export const ICON_LOCK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
