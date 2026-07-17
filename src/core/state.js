// ════════════════════════════════════════════════════════════════════════════
// 共用可變狀態 + 設定存取
// 模組化後各模組共享同一個 S 物件，取代原本 IIFE 的模組層級變數。
// ════════════════════════════════════════════════════════════════════════════

import { DEFAULT_SETTINGS, SETTINGS_KEY } from './constants.js';

// lce_settings 這一格有兩個主人：
//   根層級的欄位  → 登入頁自己的設定（本檔的 S.settings）
//   features 子物件 → 全域功能設定（core/feature-settings.js 的 ui / theme）
// 兩邊各存各的，誰都不能整包覆寫，否則會把對方的資料洗掉。

function readRoot() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
}

export function loadSettings() {
    const root = readRoot();
    delete root.features;   // 那是 feature-settings.js 的地盤，S.settings 不該持有它
    return Object.assign({}, DEFAULT_SETTINGS, root);
}

/**
 * 存回登入頁設定。
 *
 * 一定要 read-modify-write，不能直接 JSON.stringify(S.settings)：
 * S.settings 是頁面載入時的快照，裡面沒有 features（loadSettings 已剝掉），
 * 整包覆寫等於把 feature-settings 後來寫進去的 features 整個刪掉 ——
 * 使用者只要在登入頁動一下「顯示頭像」或背景，主題與登入介面的共用設定就全沒了。
 * 這正是「共用設定常常失效」的原因。
 */
export function saveSettings() {
    const root = readRoot();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...root, ...S.settings }));
}

export function reloadSettings() {
    S.settings = loadSettings();
    return S.settings;
}

export const S = {
    active:          false,
    stageEl:         null,
    selectedIdx:     null,
    settingsOpen:    false,
    statusTimer:     null,
    lastLayout:      null,
    lastStatusMsg:   null,
    lastStatusError: null,
    settings:        loadSettings(),
};
