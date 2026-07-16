// ════════════════════════════════════════════════════════════════════════════
// 共用可變狀態 + 設定存取
// 模組化後各模組共享同一個 S 物件，取代原本 IIFE 的模組層級變數。
// ════════════════════════════════════════════════════════════════════════════

import { DEFAULT_SETTINGS, SETTINGS_KEY } from './constants.js';

export function loadSettings() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings));
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
    fusamObserver:   null,
    settings:        loadSettings(),
};
