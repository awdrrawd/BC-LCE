// ════════════════════════════════════════════════════════════════════════════
// 介面字型（themeFont）—— 主題分類下的字型設定
//
// 兩條路一起套，因為 BC 的文字有兩種來源：
//   1. canvas 文字（按鈕、名稱、選單…大部分 UI）：字型來自 BC 的 CommonGetFontName()，
//      它讀 CommonFontStacks[玩家字型設定]。我們把使用者字型「插到最前面」，原本的字型
//      與 generic 留作後備。CommonFontStacks / CommonGetFontName 是 BC 頂層 const、不在
//      window 上，能不能從模組取到視環境而定 —— 一律用 typeof 探測 + try/catch，取不到
//      就只套 CSS（不報錯）。
//   2. HTML 文字（聊天記錄、輸入框、LCE 自己的介面）：canvas hook 碰不到，用注入 CSS。
//
// ── 關於「缺字」──
// 不需要什麼「雙字元」特別處理：CSS 與 canvas 的字型字串本來就是「字型堆疊（font stack）」，
// 瀏覽器會「逐字」沿堆疊往後找第一個有該字符的字型。所以只要在使用者字型後面接上一串
// 夠廣的萬用後備（含常見 CJK 字型與 generic），某字型缺某字時就會自動用後備補上。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { injectStyle } from '../core/util.js';

const LOG = '🐈‍⬛ [LCE]';
const STYLE_ID = 'lce-theme-font';

// 萬用後備字型鏈：西文 + 常見 CJK（Windows / macOS / Linux 各一）+ generic。
// 使用者字型排在這串前面，缺字就逐字後退到這裡。
const FALLBACK = [
    '"Segoe UI"', '"Helvetica Neue"', 'Arial',
    '"PingFang TC"', '"Microsoft JhengHei"', '"Microsoft YaHei"', '"Noto Sans CJK TC"', '"Noto Sans"',
    'sans-serif',
];

// ───────────────────────── 系統字型偵測（給設定頁下拉用）─────────────────────────
// 常見候選字型（Windows / macOS / Linux + CJK）。canvas 探測法只能「驗證某字型在不在」，
// 沒辦法憑空列舉，所以先備一份候選、再逐一驗證。若瀏覽器支援 Local Font Access API
//（Chromium，需權限）就直接拿系統真正的完整清單。
const FONT_CANDIDATES = [
    // Windows
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
    'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic', 'Gabriola', 'Gadugi', 'Georgia',
    'Impact', 'Ink Free', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft JhengHei',
    'Microsoft YaHei', 'MingLiU', 'MingLiU-ExtB', 'MS Gothic', 'MS PGothic', 'MV Boli', 'Nirmala UI',
    'NSimSun', 'Palatino Linotype', 'PMingLiU', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'SimHei',
    'SimSun', 'Sitka', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic', 'Yu Mincho',
    // macOS
    'Helvetica', 'Helvetica Neue', 'PingFang TC', 'PingFang SC', 'PingFang HK', 'Hiragino Sans',
    'Hiragino Kaku Gothic Pro', 'Apple SD Gothic Neo', 'Menlo', 'Monaco', 'Avenir', 'Avenir Next', 'Times',
    // Linux / Noto / 開源
    'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif', 'Ubuntu',
    'Cantarell', 'Noto Sans', 'Noto Serif', 'Noto Sans TC', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR',
    'Noto Sans CJK TC', 'Noto Sans CJK SC', 'Source Han Sans', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei',
];

const PROBE_TEXT = 'mmmmmmmmmmlli WÑ字體測試가1234';
const PROBE_BASES = ['monospace', 'serif', 'sans-serif'];
let probeBaseWidths = null;
let probeCtx = null;

function probeWidth(fontFamily) {
    if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
    probeCtx.font = `72px ${fontFamily}`;
    return probeCtx.measureText(PROBE_TEXT).width;
}

/** canvas 探測：某字型有裝，"字型, 基準" 的量測寬度就會跟純基準不同。 */
function isFontInstalled(name) {
    if (!probeBaseWidths) probeBaseWidths = PROBE_BASES.map(b => probeWidth(b));
    const q = /\s/.test(name) ? `"${name}"` : name;
    return PROBE_BASES.some((b, i) => probeWidth(`${q}, ${b}`) !== probeBaseWidths[i]);
}

/**
 * 列出可選字型。首選 Local Font Access API（拿系統真正完整清單，需在使用者手勢中呼叫、
 * 會跳權限），不支援或被拒就退回「候選清單逐一探測」。
 * @returns {Promise<string[]>}
 */
export async function listSystemFonts() {
    try {
        if (typeof window.queryLocalFonts === 'function') {
            const fonts = await window.queryLocalFonts();
            const fams = [...new Set(fonts.map(f => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            if (fams.length) return fams;
        }
    } catch { /* 使用者拒絕權限或不支援 → 退回探測 */ }
    return FONT_CANDIDATES.filter(isFontInstalled).sort((a, b) => a.localeCompare(b));
}

/** 使用者填的字型名稱 → 乾淨的字型清單（含空白者補引號）。允許逗號分隔多個。 */
function userFontNames() {
    const raw = String(getFeature('themeFont') ?? '').trim();
    if (!raw) return [];
    return raw.split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
}

/** 字型是否啟用：左側勾選箱開，且真的填了字型名稱。 */
function fontEnabled() {
    return !!getFeature('themeFontEnabled') && userFontNames().length > 0;
}

/** 給 CSS 用的字型字串（有空白的名稱補引號）。未啟用回空字串。 */
function cssFontStack() {
    if (!fontEnabled()) return '';
    const user = userFontNames().map(n => (/\s/.test(n) ? `"${n}"` : n));
    return [...user, ...FALLBACK].join(', ');
}

// ───────────────────────── canvas 字型 ─────────────────────────
// 兩種手段，擇一：
//   (A) 首選：改 BC 的 CommonFontStacks（把使用者字型插到最前）。乾淨、零逐幀成本，
//       但這是頂層 const，模組取不取得到看環境。
//   (B) 後備：攔 MainCanvas（BC 的 2D context，是 var 全域、一定取得到）的 font setter，
//       在每次設定字型時把 family 換掉。保證有效，成本用 memoize 壓到可忽略。
let originalStacks = null;   // (A) 首次套用前的 CommonFontStacks 快照（供還原）

/** BC 的字型 const 這個環境取得到嗎？取不到就走後備 (B)。 */
function canvasStacksAvailable() {
    try {
        return typeof CommonFontStacks !== 'undefined' && CommonFontStacks
            && typeof CommonGetFontName !== 'undefined'
            && typeof CommonGetFont !== 'undefined';
    } catch { return false; }
}

/** (A) 直接改 BC 的字型堆疊。 */
function applyCanvasFontViaStacks() {
    if (!fontEnabled() && !originalStacks) return;   // 從沒套過又要停用 = 沒事可做
    if (!originalStacks) {
        originalStacks = {};
        for (const k of Object.keys(CommonFontStacks)) originalStacks[k] = CommonFontStacks[k];
    }
    if (fontEnabled()) {
        const user = userFontNames();
        for (const k of Object.keys(originalStacks)) {
            const [names, generic] = originalStacks[k];
            CommonFontStacks[k] = [[...user, ...names], generic];   // 使用者字型插到最前，原字型當後備
        }
    } else {
        for (const k of Object.keys(originalStacks)) CommonFontStacks[k] = originalStacks[k];
    }
    // CommonGetFont(Name) 有 memoize，改了堆疊要清快取才會重算。
    CommonGetFontName.clearCache?.();
    CommonGetFont.clearCache?.();
}

// (B) MainCanvas.font setter 攔截
let trapInstalled = false;
let trapEnabled = false;
const trapCache = new Map();   // 原字型字串 → 換過的字型字串（BC 每幀狂設，靠這個省算）

/** 把 "36px \"Arial\", sans-serif" → "36px \"使用者字型\", \"Arial\", sans-serif"。 */
function rewriteFontString(v) {
    if (typeof v !== 'string' || !v) return v;
    if (!trapEnabled) return v;
    const cached = trapCache.get(v);
    if (cached !== undefined) return cached;
    const user = userFontNames();
    if (!user.length) { trapCache.set(v, v); return v; }
    // 字型字串格式：`<style/variant/weight><size 含單位> <family>`。抓 size（含單位）為界，其後為 family。
    const m = v.match(/^(.*?\d*\.?\d+(?:px|pt|em|rem|%|ex|ch)\s+)(.*)$/i);
    const prefix = m ? m[1] : '';
    const family = m ? m[2] : v;
    const userStr = user.map(n => (/\s/.test(n) ? `"${n}"` : n)).join(', ');
    const out = `${prefix}${userStr}, ${family}`;
    trapCache.set(v, out);
    return out;
}

function installFontTrap() {
    if (trapInstalled) return;
    try {
        if (typeof MainCanvas === 'undefined' || !MainCanvas || typeof CanvasRenderingContext2D === 'undefined') return;
        const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
        if (!desc?.get || !desc?.set) return;
        Object.defineProperty(MainCanvas, 'font', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, rewriteFontString(v)); },
        });
        trapInstalled = true;
    } catch (e) { console.warn(LOG, 'canvas 字型攔截安裝失敗:', e); }
}

function applyCanvasFont() {
    if (canvasStacksAvailable()) {
        try { applyCanvasFontViaStacks(); return; }
        catch (e) { console.warn(LOG, 'canvas 字型（改堆疊）失敗，改用攔截:', e); }
    }
    // 後備：context 攔截。只有真的要啟用時才裝攔截器 —— 預設關閉的使用者不該被動到 canvas。
    if (fontEnabled()) installFontTrap();
    trapEnabled = fontEnabled() && trapInstalled;
    trapCache.clear();   // 啟用/停用/換字型都清快取，讓下一次重算
}

// ───────────────────────── HTML（CSS）字型 ─────────────────────────
function applyCssFont() {
    if (!fontEnabled()) {
        const el = document.getElementById(STYLE_ID);
        if (el) el.textContent = '';
        return;
    }
    const stack = cssFontStack();
    injectStyle(STYLE_ID, `
:root { --lce-font: ${stack}; }
/* 聊天記錄 / 輸入框（canvas 之外的 HTML 文字）＋ LCE 自己的介面 */
#TextAreaChatLog, #TextAreaChatLog *, #InputChat,
.ChatMessage, .lce-notification,
#lce-im, #lce-im * {
    font-family: var(--lce-font) !important;
}
`);
}

/** 依目前設定套用字型（canvas + CSS）。設定改了就再呼叫一次。 */
export function applyThemeFont() {
    applyCanvasFont();
    applyCssFont();
}

let installed = false;

export function installThemeFont() {
    if (installed) return;
    installed = true;
    applyThemeFont();
    // 設定頁改字型（或切換啟用勾選）會發出這個事件，key 一律是基底鍵 themeFont。
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e.detail?.key === 'themeFont') applyThemeFont();
    });
}
