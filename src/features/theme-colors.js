// ════════════════════════════════════════════════════════════════════════════
// 主題色運算（移植 Themed src/utilities/color.ts + color 套件用到的部分）
//
// 關鍵：BC 的顏色字串五花八門（"White"、"Cyan"、"#888"、"#ebebe4"、"rgba(...)"），
// 不能只比對字面。Themed 的做法是用瀏覽器把任意 CSS 顏色解析成 hex（getHexComputed），
// 再依「已知色 → 語意色」的對照表換色，並用 HSL 的 lighten/darken 衍生狀態色。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../core/feature-settings.js';
import { THEME_COLOR_KEYS } from '../core/settings-schema.js';

// ───────────────── CSS 顏色 → hex（memoize，移植自 Themed _Color.getComputed）─────────────────
const computedCache = new Map();

function rgbStringToHex(s) {
    const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!m) return null;
    const to2 = (n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, '0');
    return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

/** 任意 CSS 顏色（名稱/hex/rgb）→ '#rrggbb'；無法解析回傳 null。 */
export function getHexComputed(color) {
    if (typeof color !== 'string' || !color.trim()) return null;
    const key = color.trim().toLowerCase();
    if (computedCache.has(key)) return computedCache.get(key);
    let hex = null;
    try {
        const div = document.createElement('div');
        div.style.color = key;
        if (div.style.color) {           // 無效顏色會讓 style.color 留空
            div.style.display = 'none';
            document.body.appendChild(div);
            hex = rgbStringToHex(getComputedStyle(div).color);
            div.remove();
        }
    } catch { hex = null; }
    computedCache.set(key, hex);
    return hex;
}

// ───────────────── HSL lighten / darken（等同 color 套件的行為）─────────────────
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, l];
}

function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to2 = (v) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0');
    return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** 解析成 hex：先問瀏覽器（可解析色名），失敗時退回原本就是 hex 的情況。 */
function toHex(color) {
    return getHexComputed(color)
        ?? (typeof color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : null);
}

function shift(color, ratio) {
    const hex = toHex(color);
    if (!hex) return color;
    const [h, s, l] = rgbToHsl(...hexToRgb(hex));
    return hslToHex(h, s, Math.max(0, Math.min(1, l + l * ratio)));
}

export const lighten = (color, ratio) => shift(color, ratio);
export const darken = (color, ratio) => shift(color, -ratio);

/** 兩色等比混合（等同 color 套件 .mix(other, 0.5)：同 alpha 時就是 RGB 平均）。 */
export function mix(a, b, weight = 0.5) {
    const ha = toHex(a), hb = toHex(b);
    if (!ha || !hb) return ha ?? hb ?? a;
    const ra = hexToRgb(ha), rb = hexToRgb(hb);
    const to2 = (v) => Math.round(v).toString(16).padStart(2, '0');
    return `#${ra.map((v, i) => to2(v * (1 - weight) + rb[i] * weight)).join('')}`;
}

/** WCAG 相對亮度判斷（與 BC_ThemeColorCheck 的 isDark 同一套想法）。 */
export function isDark(color) {
    const hex = toHex(color);
    if (!hex) return false;
    const [r, g, b] = hexToRgb(hex).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.5;
}

// ───────────────── 語意色盤（移植 Themed plainColors / specialColors）─────────────────
export const plainColors = {
    main: '', element: '', elementHover: '', elementDisabled: '', elementHint: '',
    text: '', textDisabled: '', textShadow: '', accent: '', accentHover: '', accentDisabled: '',
};

/** 狀態色：[基本色, hover 色]，索引 0/1。 */
export const specialColors = {
    invalid: ['', ''], equipped: ['', ''], crafted: ['', ''], blocked: ['', ''], limited: ['', ''],
    allowed: ['', ''], roomFriend: ['', ''], roomBlocked: ['', ''], roomGame: ['', ''],
};

const SPECIAL_KEYS = {
    invalid: 'themeInvalid', equipped: 'themeEquipped', crafted: 'themeCrafted', blocked: 'themeBlocked',
    limited: 'themeLimited', allowed: 'themeAllowed', roomFriend: 'themeRoomFriend',
    roomBlocked: 'themeRoomBlocked', roomGame: 'themeRoomGame',
};

/**
 * 依設定重算色盤（移植 Themed _Color.composeRoot）。
 * 簡易模式：只讀主/強調/文字色，其餘用 lighten/darken 衍生。
 * 進階模式：每一項直接採用使用者填的值。
 */
let lastKey = null;

export function composeColors() {
    // 只有顏色設定真的變動時才重算：composeColors() 會被繪圖 hook 高頻呼叫，
    // 沒有這道快取的話會做大量 getComputedStyle（每次都會觸發 reflow）。
    const key = `${getFeature('themeMode')}|${THEME_COLOR_KEYS.map(k => getFeature(k)).join('|')}`;
    if (key === lastKey) return plainColors;
    lastKey = key;

    for (const [k, settingKey] of Object.entries(SPECIAL_KEYS)) {
        const hex = getHexComputed(getFeature(settingKey)) ?? '#000000';
        specialColors[k] = [hex, lighten(hex, 0.2)];
    }

    if (getFeature('themeMode') === 'advanced') {
        plainColors.main            = getHexComputed(getFeature('themeMainColor'))       ?? '#202020';
        plainColors.accent          = getHexComputed(getFeature('themeAccentColor'))     ?? '#440171';
        plainColors.accentHover     = getHexComputed(getFeature('themeAccentHover'))     ?? '#5a0194';
        plainColors.accentDisabled  = getHexComputed(getFeature('themeAccentDisabled'))  ?? '#2e014d';
        plainColors.element         = getHexComputed(getFeature('themeElement'))         ?? '#2e2e2e';
        plainColors.elementHover    = getHexComputed(getFeature('themeElementHover'))    ?? '#4a4a4a';
        plainColors.elementDisabled = getHexComputed(getFeature('themeElementDisabled')) ?? '#1a1a1a';
        plainColors.elementHint     = getHexComputed(getFeature('themeElementHint'))     ?? '#4a4a4a';
        plainColors.text            = getHexComputed(getFeature('themeTextColor'))       ?? '#cccccc';
        plainColors.textDisabled    = getHexComputed(getFeature('themeTextDisabled'))    ?? '#a3a3a3';
        plainColors.textShadow      = getHexComputed(getFeature('themeTextShadow'))      ?? '#a3a3a3';
        return plainColors;
    }

    const main   = getHexComputed(getFeature('themeMainColor'))   ?? '#202020';
    const accent = getHexComputed(getFeature('themeAccentColor')) ?? '#440171';
    const text   = getHexComputed(getFeature('themeTextColor'))   ?? '#cccccc';
    const element = lighten(main, 0.2);

    plainColors.main            = main;
    plainColors.element         = element;
    plainColors.elementHover    = lighten(element, 0.2);
    plainColors.elementDisabled = darken(element, 0.2);
    plainColors.elementHint     = lighten(element, 0.2);
    plainColors.text            = text;
    plainColors.textDisabled    = darken(text, 0.2);
    plainColors.textShadow      = darken(text, 0.2);
    plainColors.accent          = accent;
    plainColors.accentHover     = lighten(accent, 0.2);
    plainColors.accentDisabled  = darken(accent, 0.2);
    return plainColors;
}

const kebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/**
 * 產生 :root CSS 變數（移植 Themed composeRoot）。
 * BC 現在多數畫面是 HTML，樣式表就是靠這些變數取色。
 */
export function composeRootCss() {
    composeColors();
    let out = '';
    for (const [k, v] of Object.entries(plainColors)) out += `--lce-${kebab(k)}:${v};`;
    for (const [k, v] of Object.entries(specialColors)) {
        out += `--lce-${kebab(k)}:${v[0]};--lce-${kebab(k)}-hover:${v[1]};`;
    }
    // 房間搜尋「已滿」的混色（移植 Themed 的 search-full-*）
    out += `--lce-search-full-blocked:${mix(specialColors.roomBlocked[0], plainColors.elementDisabled)};`;
    out += `--lce-search-full-blocked-hover:${mix(specialColors.roomBlocked[1], plainColors.elementDisabled)};`;
    out += `--lce-search-full-friend:${mix(specialColors.roomFriend[0], plainColors.elementDisabled)};`;
    out += `--lce-search-full-friend-hover:${mix(specialColors.roomFriend[1], plainColors.elementDisabled)};`;
    return `:root{${out}}`;
}
