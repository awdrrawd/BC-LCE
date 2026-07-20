// ════════════════════════════════════════════════════════════════════════════
// LCE 設定頁（Canvas，掛進 BC 偏好設定）
// 移植自 WCE src/functions/settingsPage.ts，改用 LCE 的 schema / i18n / 儲存層。
// 透過 PreferenceRegisterExtensionSetting 註冊，繪製走 BC 全域 DrawText/DrawButton/…。
// ════════════════════════════════════════════════════════════════════════════

import { CATEGORIES, DEFAULT_FEATURE_SETTINGS, clampBar } from '../core/settings-schema.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { fSettings, saveFeatureSettings } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { applyTheme } from '../features/theme.js';
import { listSystemFonts } from '../features/theme-font.js';
import iconUrl from '../assets/lce-icon.svg';

const SWATCH_W = 64;   // 色塊寬度（與十六進位欄位齊平）
const ACTION_W = 500;  // 動作鈕寬度（自 x=300 起）
const SOUND_W = 64;    // 音效開關寬度（接在控制項右側）
const SOUND_GAP = 10;

const SETTINGS_PER_PAGE = 8;
const Y_START = 225;
const Y_INC = 70;
const SEL_OFFSET = 900;   // select / input / bar / action 控制項起始 X
const SEL_WIDTH = 340;

// 說明框：左緣 200、右緣維持在 1900（跟頁面其他內容的右界一致）
const TOOLTIP_X = 200;
const TOOLTIP_W = 1700;

// bar：軌道與右側數值欄
const BAR_H = 20;         // 軌道高度
const BAR_TOP = 22;       // 軌道相對於該列 y 的位移（(64 - 20) / 2，讓軌道垂直置中）
const BAR_VAL_W = 110;    // 數值文字欄寬

// 導覽狀態
let currentCategory = null;   // null = 分類清單
let currentPage = 0;
let currentSetting = '';      // 目前選中的設定 key（顯示描述用）
const actionDone = new Set(); // 已點過的動作按鈕（顯示回饋文字）

function settingsInCategory(category) {
    return Object.entries(DEFAULT_FEATURE_SETTINGS).filter(([, def]) => def.category === category);
}

/** 將某分類切成多頁：每頁最多 8 項，遇到 pageBreakBefore 強制換頁。 */
function computePages(category) {
    const pages = [];
    let cur = [];
    for (const entry of settingsInCategory(category)) {
        const [, def] = entry;
        if ((def.pageBreakBefore && cur.length) || cur.length >= SETTINGS_PER_PAGE) {
            pages.push(cur); cur = [];
        }
        cur.push(entry);
    }
    if (cur.length) pages.push(cur);
    return pages.length ? pages : [[]];
}

function pageCount(category) { return computePages(category).length; }
function pageSlice(category) {
    const pages = computePages(category);
    return pages[Math.min(currentPage, pages.length - 1)] || [];
}

/** select：顯示目前值對應的 optionLabel（無 optionLabels 時直接顯示值）。 */
function selDisplay(def, value) {
    const idx = def.options.indexOf(value);
    const lblKey = def.optionLabels?.[idx] ?? value;
    return T(lblKey);
}

/** 顏色設定：值壞掉時退回 schema 預設，不讓整個說明框畫不出來。 */
function uiColor(key) {
    const v = fSettings[key];
    if (typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(v)) return v;
    return DEFAULT_FEATURE_SETTINGS[key]?.value ?? '#000000';
}

/**
 * WCE 風格的說明框（drawTooltip）。底色與文字色可由 UI 設置調整。
 *
 * 與 BC 主題的關係：染色引擎是靠比對顏色換色的（#ffff88 → element、
 * #000000 → text，見 features/theme.js 的 KNOWN 對照表與 DrawTextFit hook）。
 * 所以維持預設值時，開主題說明框仍會跟著染色，行為與以前一模一樣；
 * 一旦使用者挑了別的顏色，對照表就比不中，主題不再插手 —— 明講要什麼顏色就給什麼顏色。
 *
 * 邊框沿用文字色：底色被改深時，原本寫死的黑框會整個看不見。
 */
function drawTooltip(x, y, width, text) {
    const ctx = window.MainCanvas?.getContext('2d');
    if (!ctx) return;
    const bg = uiColor('tooltipBgColor');
    const fg = uiColor('tooltipTextColor');
    const bak = ctx.textAlign;
    ctx.textAlign = 'left';
    DrawRect(x, y, width, 65, bg);
    DrawEmptyRect(x, y, width, 65, fg, 2);
    DrawTextFit(text, x + 3, y + 33, width - 6, fg);
    ctx.textAlign = bak;
}

// ───────────────────────────── BC 偏好子畫面回呼 ─────────────────────────────

function load() {
    currentCategory = null;
    currentPage = 0;
    currentSetting = '';
    actionDone.clear();
}

function exit() {
    saveFeatureSettings();
    if (typeof PreferenceSubscreenExtensionsClear === 'function') PreferenceSubscreenExtensionsClear();
}

function run() {
    const ctx = window.MainCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.textAlign = 'left';

    const title = currentCategory ? `${T('lce_settings_title')} — ${T('cat_' + currentCategory)}` : T('lce_settings_title');
    DrawText(title, 300, 125, 'Black', 'Gray');
    DrawButton(1815, 75, 90, 90, '', 'White', 'Icons/Exit.png');

    let y = Y_START;
    if (!currentCategory) {
        for (const category of CATEGORIES) {
            DrawButton(300, y, 400, 64, '', 'White');
            DrawTextFit(T('cat_' + category), 310, y + 32, 380, 'Black');
            y += Y_INC;
        }
        ctx.textAlign = 'center';
        return;
    }

    DrawText(T('lce_click_hint'), 300, 190, 'Gray', 'Silver');

    for (const [key, def] of pageSlice(currentCategory)) {
        const disabled = !!def.disabled?.(fSettings);
        const highlight = currentSetting === key ? 'Red' : 'Black';

        if (def.type === 'checkbox') {
            DrawCheckbox(300, y, 64, 64, T(def.label), !!fSettings[key], disabled, highlight);
        } else if (def.withToggle) {
            // 左側勾選箱 + 右側控制項（關閉時右側停用）
            const enabled = !!fSettings[`${key}Enabled`];
            DrawCheckbox(300, y, 64, 64, T(def.label), enabled, disabled, highlight);
            const ctrlDisabled = disabled || !enabled;
            if (def.type === 'select') {
                const idx = def.options.indexOf(fSettings[key]);
                const len = def.options.length;
                DrawBackNextButton(
                    SEL_OFFSET, y, SEL_WIDTH, 64, selDisplay(def, fSettings[key]),
                    ctrlDisabled ? '#ebebe4' : 'White', '',
                    () => selDisplay(def, def.options[(idx - 1 + len) % len]),
                    () => selDisplay(def, def.options[(idx + 1 + len) % len]),
                    ctrlDisabled,
                );
            } else if (def.type === 'bar') {
                drawBarControl(key, def, y, ctrlDisabled);
            } else { // input
                drawInputControl(key, def, y, ctrlDisabled);
            }
            if (def.withSound) drawSoundToggle(key, y, ctrlDisabled);
        } else if (def.type === 'select') {
            DrawText(T(def.label), 400, y + 33, highlight, 'Gray');
            const idx = def.options.indexOf(fSettings[key]);
            const len = def.options.length;
            DrawBackNextButton(
                SEL_OFFSET, y, SEL_WIDTH, 64, selDisplay(def, fSettings[key]),
                disabled ? '#ebebe4' : 'White', '',
                () => selDisplay(def, def.options[(idx - 1 + len) % len]),
                () => selDisplay(def, def.options[(idx + 1 + len) % len]),
                disabled,
            );
        } else if (def.type === 'bar') {
            DrawText(T(def.label), 400, y + 33, highlight, 'Gray');
            drawBarControl(key, def, y, disabled);
        } else if (def.type === 'input') {
            DrawText(T(def.label), 400, y + 33, highlight, 'Gray');
            drawInputControl(key, def, y, disabled);
        } else if (def.type === 'action') {
            // 動作鈕置於左側欄位（與勾選箱同一起點 x=300），按鈕本身即標題
            const caption = actionDone.has(key) ? T(def.actionDoneLabel) : T(def.label);
            centered(() => DrawButton(300, y, ACTION_W, 64, caption, disabled ? '#ebebe4' : 'White', '', '', disabled));
        }
        y += Y_INC;
    }

    // 描述說明框。左緣從 300 移到 200、寬度補回 100 讓右緣仍停在 1900 ——
    // 說明文字是靠 DrawTextFit 縮字來塞進框裡的，框愈窄字就被壓得愈小愈難讀。
    if (currentSetting && DEFAULT_FEATURE_SETTINGS[currentSetting]) {
        drawTooltip(TOOLTIP_X, 830, TOOLTIP_W, T(DEFAULT_FEATURE_SETTINGS[currentSetting].desc));
    }

    if (pageCount(currentCategory) > 1) {
        DrawText(`${currentPage + 1} / ${pageCount(currentCategory)}`, 1700, 230, 'Black', 'Gray');
        DrawButton(1815, 180, 90, 90, '', 'White', 'Icons/Next.png');
    }
    ctx.textAlign = 'center';
}

/**
 * 套用單一設定的變更。
 * 除了呼叫 schema 的 sideEffects，還會發出 lce-setting-changed 事件 ——
 * schema 不能 import 功能模組（會循環相依：schema ← feature-settings ← 功能模組），
 * 所以需要即時反應的功能（例如拓展衣櫃）改用監聽事件的方式接。
 */
function fireSideEffect(key, def) {
    try { def.sideEffects?.(fSettings[key], false, fSettings); }
    catch (e) { console.warn('🐈‍⬛ [LCE]', e); }
    try { window.dispatchEvent(new CustomEvent(SETTING_CHANGED_EVENT, { detail: { key, value: fSettings[key] } })); }
    catch { /* ignore */ }
}

function click() {
    if (MouseIn(1815, 75, 90, 90)) {
        if (currentCategory === null) { exit(); }
        else { currentCategory = null; currentSetting = ''; }
        return;
    }

    if (currentCategory === null) {
        let y = Y_START;
        for (const category of CATEGORIES) {
            if (MouseIn(300, y, 400, 64)) { currentCategory = category; currentPage = 0; currentSetting = ''; return; }
            y += Y_INC;
        }
        return;
    }

    if (MouseIn(1815, 180, 90, 90) && pageCount(currentCategory) > 1) {
        currentPage = (currentPage + 1) % pageCount(currentCategory);
        return;
    }

    let y = Y_START;
    for (const [key, def] of pageSlice(currentCategory)) {
        const disabled = !!def.disabled?.(fSettings);

        if (def.type === 'checkbox') {
            if (MouseIn(300, y, 64, 64) && !disabled) { fSettings[key] = !fSettings[key]; fireSideEffect(key, def); }
        } else if (def.withToggle) {
            const enabled = !!fSettings[`${key}Enabled`];
            if (MouseIn(300, y, 64, 64) && !disabled) {
                fSettings[`${key}Enabled`] = !enabled; fireSideEffect(key, def);
            } else if (enabled && !disabled) {
                if (def.withSound && MouseIn(...soundRect(y))) {
                    fSettings[`${key}Sound`] = !fSettings[`${key}Sound`];
                    fireSideEffect(key, def);
                } else {
                    adjustControl(key, def, y);
                }
            }
        } else if (def.type === 'select' && !disabled) {
            adjustControl(key, def, y);
        } else if (def.type === 'bar' && !disabled) {
            handleBarClick(key, def, y);
        } else if (def.type === 'input' && !disabled) {
            handleInputClick(key, def, y);
        } else if (def.type === 'action' && !disabled) {
            if (MouseIn(300, y, ACTION_W, 64)) { try { def.run?.(fSettings); } catch (e) { console.warn('🐈‍⬛ [LCE]', e); } actionDone.add(key); }
        }

        if (MouseIn(300, y, 1200, 64)) currentSetting = key;
        y += Y_INC;
    }

    // 主題分類任何變更後即時重新套用染色，讓效果立刻可見
    if (currentCategory === 'theme') applyTheme();
}

function adjustControl(key, def, y) {
    if (def.type === 'select') {
        const seg = SEL_WIDTH / 2;
        const idx = def.options.indexOf(fSettings[key]);
        const len = def.options.length;
        if (MouseIn(SEL_OFFSET + seg, y, seg, 64)) { fSettings[key] = def.options[(idx + 1 + len) % len]; fireSideEffect(key, def); }
        else if (MouseIn(SEL_OFFSET, y, seg, 64)) { fSettings[key] = def.options[(idx - 1 + len) % len]; fireSideEffect(key, def); }
    } else if (def.type === 'bar') {
        handleBarClick(key, def, y);
    } else if (def.type === 'input') {
        handleInputClick(key, def, y);
    }
}

/**
 * 以置中文字繪製。run() 為了畫左側標籤把 textAlign 設成 left，
 * 但 DrawButton 是把文字畫在 Left+Width/2，left 對齊會讓文字偏右，故按鈕文字要暫時切回 center。
 */
function centered(fn) {
    const ctx = window.MainCanvas?.getContext('2d');
    const bak = ctx?.textAlign;
    if (ctx) ctx.textAlign = 'center';
    try { fn(); } finally { if (ctx) ctx.textAlign = bak; }
}

/** 音效開關的座標（接在右側控制項之後）。 */
const soundRect = (y) => [SEL_OFFSET + SEL_WIDTH + SOUND_GAP, y, SOUND_W, 64];

/** 音效開關：Icons/Audio2=有聲、Icons/Audio0=靜音。 */
function drawSoundToggle(key, y, disabled) {
    const on = !!fSettings[`${key}Sound`];
    DrawButton(...soundRect(y), '', disabled ? '#ebebe4' : 'White',
        on ? 'Icons/Audio2.png' : 'Icons/Audio0.png',
        T(on ? 'sound_on' : 'sound_off'), disabled);
}

/**
 * 繪製 bar 控制項：軌道 + 已填滿的部分 + 拉桿，右側附目前數值。
 * 顏色刻意沿用染色引擎已經涵蓋的幾種（White / Black / #3575b5 = themeEquipped），
 * 主題開啟時會跟著變，不必在這裡自己查主題色。
 */
function drawBarControl(key, def, y, disabled) {
    const v = clampBar(def, fSettings[key]);
    const ratio = (v - def.min) / (def.max - def.min);
    const top = y + BAR_TOP;

    DrawRect(SEL_OFFSET, top, SEL_WIDTH, BAR_H, disabled ? '#ebebe4' : 'White');
    if (ratio > 0) DrawRect(SEL_OFFSET, top, SEL_WIDTH * ratio, BAR_H, disabled ? '#c8c8c0' : '#3575b5');
    DrawEmptyRect(SEL_OFFSET, top, SEL_WIDTH, BAR_H, 'Black', 2);

    // 拉桿：夾在軌道內，兩端才不會畫到軌道外面
    const hx = SEL_OFFSET + Math.max(6, Math.min(SEL_WIDTH - 6, SEL_WIDTH * ratio));
    DrawRect(hx - 6, y + 12, 12, 40, disabled ? '#c8c8c0' : 'Black');

    centered(() => DrawTextFit(String(v), SEL_OFFSET + SEL_WIDTH + SOUND_GAP + BAR_VAL_W / 2, y + 33,
        BAR_VAL_W, disabled ? 'Gray' : 'Black'));
}

/** 點擊 bar：點到哪就跳到哪一格（依 step 對齊）。整列 64 高都算，不必精準點在軌道上。 */
function handleBarClick(key, def, y) {
    if (!MouseIn(SEL_OFFSET, y, SEL_WIDTH, 64)) return;
    const ratio = (MouseX - SEL_OFFSET) / SEL_WIDTH;
    const next = clampBar(def, def.min + ratio * (def.max - def.min));
    if (next !== fSettings[key]) { fSettings[key] = next; fireSideEffect(key, def); }
}

/** 繪製 input 控制項：色彩型別 → 十六進位欄位 + 齊平色塊；其餘 → 一般數值鈕。 */
function drawInputControl(key, def, y, disabled) {
    centered(() => {
        if (def.subtype === 'color') {
            const hexW = SEL_WIDTH - SWATCH_W;
            DrawButton(SEL_OFFSET, y, hexW, 64, String(fSettings[key] ?? ''), disabled ? '#ebebe4' : 'White', '', '', disabled);
            const val = fSettings[key];
            const col = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(val) ? val : '#000000';
            DrawButton(SEL_OFFSET + hexW, y, SWATCH_W, 64, '', disabled ? '#ebebe4' : col, '', '', disabled);
        } else {
            // 字型欄位空白時顯示提示，讓使用者知道是點開下拉挑選的。
            const shown = def.subtype === 'font' && !fSettings[key] ? T('themeFont_pick') : String(fSettings[key] ?? '');
            DrawButton(SEL_OFFSET, y, SEL_WIDTH, 64, shown, disabled ? '#ebebe4' : 'White', '', '', disabled);
        }
    });
}

/** 點擊 input：色彩型別左側欄位=填色碼、右側色塊=叫出調色器；其餘=直接輸入。 */
function handleInputClick(key, def, y) {
    if (def.subtype === 'color') {
        const hexW = SEL_WIDTH - SWATCH_W;
        if (MouseIn(SEL_OFFSET + hexW, y, SWATCH_W, 64)) openColorPicker(key, def);
        else if (MouseIn(SEL_OFFSET, y, hexW, 64)) promptInput(key, def);
    } else if (def.subtype === 'font') {
        if (MouseIn(SEL_OFFSET, y, SEL_WIDTH, 64)) openFontPicker(key, def);
    } else if (MouseIn(SEL_OFFSET, y, SEL_WIDTH, 64)) {
        promptInput(key, def);
    }
}

let fontPickerOpen = false;

/** 開出「系統已安裝字型」的 HTML 下拉清單（canvas 設定頁上的覆蓋層，與調色器同一套做法）。 */
function openFontPicker(key, def) {
    if (fontPickerOpen) return;
    fontPickerOpen = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'lce-fontpicker-backdrop';
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        width: 'min(520px,90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: 'var(--lce-main,#222)', color: 'var(--lce-text,#eee)',
        border: '2px solid var(--lce-login-accent,#7214ff)', borderRadius: '8px',
        overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
    });

    const search = document.createElement('input');
    search.type = 'text';
    search.setAttribute('placeholder', T('themeFont_search'));
    Object.assign(search.style, {
        padding: '10px', border: '0', borderBottom: '1px solid var(--lce-login-accent,#7214ff)',
        background: 'var(--lce-element,#111)', color: 'inherit', fontSize: '16px',
    });

    const listWrap = document.createElement('div');
    Object.assign(listWrap.style, { overflowY: 'auto', overflowX: 'hidden', padding: '8px' });
    listWrap.textContent = '…';

    panel.append(search, listWrap);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const close = () => {
        fontPickerOpen = false;
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    // 別讓點擊/輸入穿到底下的 BC canvas
    panel.addEventListener('mousedown', e => e.stopPropagation());
    search.addEventListener('keydown', e => e.stopPropagation());

    const pick = (name) => { fSettings[key] = name; fireSideEffect(key, def); close(); };

    const makeRow = (label, value, previewFont) => {
        const row = document.createElement('div');
        row.textContent = label;
        const selected = fSettings[key] === value;
        Object.assign(row.style, {
            padding: '8px 10px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: selected ? 'var(--lce-login-accent,#7214ff)' : '',
        });
        if (previewFont) row.style.fontFamily = /\s/.test(previewFont) ? `"${previewFont}"` : previewFont;
        row.addEventListener('mouseenter', () => { if (!selected) row.style.background = 'var(--lce-element-hover,#3a3a3a)'; });
        row.addEventListener('mouseleave', () => { if (!selected) row.style.background = ''; });
        row.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(value); });
        return row;
    };

    let allFonts = [];
    const render = (filter = '') => {
        listWrap.textContent = '';
        listWrap.appendChild(makeRow(T('themeFont_default'), '', ''));   // 清除 → 用預設字型
        const f = filter.trim().toLowerCase();
        for (const name of allFonts) {
            if (f && !name.toLowerCase().includes(f)) continue;
            listWrap.appendChild(makeRow(name, name, name));
        }
    };
    search.addEventListener('input', () => render(search.value));

    listSystemFonts()
        .then((fonts) => { allFonts = fonts; render(); search.focus(); })
        .catch((e) => { listWrap.textContent = String(e?.message ?? e); });
}

function promptInput(key, def) {
    const next = window.prompt(T(def.label), String(fSettings[key] ?? ''));
    if (next !== null) { fSettings[key] = next; fireSideEffect(key, def); }
}

let colorPickerOpen = false;

/** 叫出 BC 內建調色器（跟 Themed 一樣）。無此 API 時退回瀏覽器原生調色器。 */
function openColorPicker(key, def) {
    const cur = /^#([0-9a-fA-F]{6})$/.test(fSettings[key]) ? fSettings[key] : '#000000';

    if (typeof ColorPickerInit === 'function' && typeof ColorPicker === 'object') {
        if (colorPickerOpen) return;
        colorPickerOpen = true;
        const paddingTop = 75;
        const paddingRight = 2000 - (1815 + 90);
        const shape = [2000 - ColorPicker.defaultShape[2] - paddingRight + 25, paddingTop, ColorPicker.defaultShape[2], 1000 - paddingTop * 2];
        ColorPickerInit({
            colorState: { colors: [cur], defaultColors: [DEFAULT_FEATURE_SETTINGS[key]?.value ?? '#ffffff'], opacity: [1], editOpacity: false },
            heading: T(def.label),
            shape,
            // BC 呼叫 onInput 的簽名是 (inputElement, event)，不是狀態物件；
            // 跟 Themed 一樣設為 no-op，顏色只在 onExit（(state, save, root)）套用。
            onInput: () => null,
            onExit: (state, save) => {
                if (save && state?.colors) { fSettings[key] = state.colors[0]; fireSideEffect(key, def); }
                applyTheme();
                colorPickerOpen = false;
                document.getElementById('lce-colorpicker-backdrop')?.toggleAttribute('hidden', true);
            },
        }).then((el) => {
            let backdrop = document.getElementById('lce-colorpicker-backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'lce-colorpicker-backdrop';
                Object.assign(backdrop.style, { backgroundColor: 'rgba(0,0,0,0.3)', width: '100%', height: '100%', position: 'absolute', top: '0', left: '0' });
                backdrop.appendChild(el);
                document.body.appendChild(backdrop);
            } else {
                backdrop.toggleAttribute('hidden', false);
            }
        }).catch(() => { colorPickerOpen = false; });
        return;
    }

    // fallback：瀏覽器原生調色器
    const input = document.createElement('input');
    input.type = 'color';
    input.value = cur;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(input);
    const apply = () => { fSettings[key] = input.value; fireSideEffect(key, def); applyTheme(); };
    input.addEventListener('input', apply);
    input.addEventListener('change', () => { apply(); input.remove(); });
    input.click();
}

// ───────────────────────────── 註冊 ─────────────────────────────

function keyHandler(e) {
    if (e.key === 'Escape' && currentCategory !== null) {
        currentCategory = null;
        currentSetting = '';
        e.stopPropagation();
        e.preventDefault();
    }
}

let installed = false;

/** 等 BC 的 PreferenceRegisterExtensionSetting 就緒後註冊 LCE 設定頁。 */
export function installSettingsPage() {
    if (installed) return;
    (function waitReg(n = 120) {
        if (typeof PreferenceRegisterExtensionSetting !== 'function') {
            if (n <= 0) { console.warn('🐈‍⬛ [LCE] 找不到 PreferenceRegisterExtensionSetting，設定頁未註冊'); return; }
            setTimeout(() => waitReg(n - 1), 500);
            return;
        }
        PreferenceRegisterExtensionSetting({
            Identifier: 'LCE',
            ButtonText: T('lce_settings_button'),
            Image: iconUrl,
            load, run, click, exit,
        });
        document.addEventListener('keydown', keyHandler, true);
        installed = true;
    })();
}
