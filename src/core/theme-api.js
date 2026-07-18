// ════════════════════════════════════════════════════════════════════════════
// 主題色 API（對外）—— window.Liko.LCE.Theme
//
// 回傳「實際套用的」解析後 hex，與染色引擎同一份色盤。
// 重點：染色**未啟用**時所有顏色一律回傳 null —— 不回傳假的 fallback 色，
//       外部才不會把「其實沒開染色」誤判成「有一個 #202020 的主色」。
//       想知道現在到底有沒有開，讀 Theme.enabled（或 isThemeEnabled()）。
// 全部用 getter：讀的當下就是當前值，設定 / 語言 / 主題一改立即反映。
//
// 用法：
//   LCE.Theme.enabled        // boolean，染色是否啟用
//   LCE.Theme.Main / .Accent / .Text …   // hex，或未啟用時 null
//   LCE.Theme.isDark         // boolean，或未啟用時 null
//   LCE.Theme.palette        // 整份色盤物件，或未啟用時 null
//   LCE.Theme.special        // 狀態色（equipped/blocked…），或未啟用時 null
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from './feature-settings.js';
import { plainColors, specialColors, composeColors, getHexComputed, isDark } from '../features/theme-colors.js';

/** 染色總開關目前是否啟用。 */
export function isThemeEnabled() { return !!getFeature('themeEnabled'); }

/** 目前實際色盤；未啟用回 null。composeColors 有快取，重複讀很便宜。 */
function live() {
    if (!isThemeEnabled()) return null;
    composeColors();
    return plainColors;
}

// plainColors 的鍵 → 對外 PascalCase 名稱
const COLOR_MAP = {
    Main: 'main',
    Accent: 'accent', AccentHover: 'accentHover', AccentDisabled: 'accentDisabled',
    Element: 'element', ElementHover: 'elementHover', ElementDisabled: 'elementDisabled', ElementHint: 'elementHint',
    Text: 'text', TextDisabled: 'textDisabled', TextShadow: 'textShadow',
};

/** 對外命名空間。凍結避免被外部覆寫；getter 仍即時運作，{...Theme} 也能快照當前全部顏色。 */
export const Theme = {};
const def = (name, get) => Object.defineProperty(Theme, name, { get, enumerable: true });

def('enabled', isThemeEnabled);
for (const [Pascal, key] of Object.entries(COLOR_MAP)) def(Pascal, () => live()?.[key] ?? null);
def('isDark', () => { const p = live(); return p ? isDark(p.main) : null; });
def('palette', () => { const p = live(); return p ? { ...p } : null; });
def('special', () => {
    const p = live();
    if (!p) return null;
    const out = {};
    for (const [k, v] of Object.entries(specialColors)) out[k] = { base: v[0], hover: v[1] };
    return out;
});
Object.freeze(Theme);

// ── 向後相容：舊的扁平取色函式 ──
// 保留讓既有呼叫不壞，但行為已與 Theme 一致：未啟用染色時回 null（不再回假 fallback 色）。
// 新程式請直接用 Theme.*。
export function getMainColor() { return Theme.Main; }
export function getAccentColor() { return Theme.Accent; }
export function getTextColor() { return Theme.Text; }
export function getPalette() { return Theme.palette; }
export function isDarkTheme() { return Theme.isDark; }

export { getHexComputed, isDark };
