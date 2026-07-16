// ════════════════════════════════════════════════════════════════════════════
// 主題色 API（對外）
// 供其他插件/模組判斷當前主題色。回傳的是「實際套用的」解析後 hex，
// 與染色引擎用的同一份色盤（未啟用主題時回傳 Themed 預設值）。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from './feature-settings.js';
import { plainColors, composeColors, getHexComputed, isDark } from '../features/theme-colors.js';

const FALLBACK = { main: '#202020', accent: '#440171', text: '#cccccc' };

function palette() {
    if (!getFeature('themeEnabled')) return null;
    composeColors();
    return plainColors;
}

/** 目前主題主色（hex）。 */
export function getMainColor() { return palette()?.main ?? FALLBACK.main; }

/** 目前主題強調色（hex）。 */
export function getAccentColor() { return palette()?.accent ?? FALLBACK.accent; }

/** 目前主題文字色（hex）。 */
export function getTextColor() { return palette()?.text ?? FALLBACK.text; }

/** 完整色盤（含 element / 狀態色等）；未啟用主題時回傳 null。 */
export function getPalette() { const p = palette(); return p ? { ...p } : null; }

/** 目前主題是否為深色（依主色亮度判斷）。 */
export function isDarkTheme() { return isDark(getMainColor()); }

export { getHexComputed, isDark };
