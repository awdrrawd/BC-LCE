// ════════════════════════════════════════════════════════════════════════════
// LCE 設定頁（Canvas，掛進 BC 偏好設定）
// 移植自 WCE src/functions/settingsPage.ts，改用 LCE 的 schema / i18n / 儲存層。
// 透過 PreferenceRegisterExtensionSetting 註冊，繪製走 BC 全域 DrawText/DrawButton/…。
// ════════════════════════════════════════════════════════════════════════════

import { CATEGORIES, DEFAULT_FEATURE_SETTINGS, IMMERSION_SECTIONS, clampBar, defaultValues } from '../core/settings-schema.js';
import { fSettings, saveFeatureSettings, setFeature, runSettingAction, updateSettings } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { langFlag, openLanguageDropdown, openFontPicker, promptInput, openColorPicker } from './pickers.js';
import { currentGameLanguage } from '../game/language.js';
import { openStorageManager, closeStorageManager, isStorageManagerOpen, positionStorageManager } from './storage-manager.js';
import { closeTrustedDomainManager, isTrustedDomainManagerOpen, openTrustedDomainManager, positionTrustedDomainManager } from './trusted-domain-manager.js';
import iconUrl from '../assets/lce-icon.svg';
import { openSettingDropdown, closeSettingDropdown, isSettingDropdownOpen } from './setting-dropdown.js';

const SWATCH_W = 64;   // 色塊寬度（與十六進位欄位齊平）
const ACTION_W = 500;  // 動作鈕寬度（自 x=300 起）
const SOUND_W = 64;    // 音效開關寬度（接在控制項右側）
const SOUND_GAP = 10;

const SETTINGS_PER_PAGE = 8;
const Y_START = 225;
const ITEM_H = 65;
const Y_INC = 81;
const SEL_OFFSET = 900;   // select / input / bar / action 控制項起始 X
const SEL_WIDTH = 340;
const HOME_COLUMNS = [300, 800, 1300];
const HOME_ITEMS_PER_COLUMN = 8;
const PANEL_CATEGORIES = new Set(['ui', 'theme', 'immersion']);
const PANEL_X = 300;
const PANEL_Y = 180;
const PANEL_W = 1400;
const PANEL_H = 650;
const PANEL_ROWS = 6;
const HEADER_RECTS = { reset: [1615, 75, 90, 90], language: [1715, 75, 90, 90], exit: [1815, 75, 90, 90] };
const TOOLTIP_Y = 870;
const NOTIFY_DURATION_X = 1400, NOTIFY_DURATION_W = 150, NOTIFY_DURATION_UNIT_X = 1560;
let notifyDurationInput = null;
let notifyDurationInputKey = null;

// Share option rectangles between drawing and hit testing. Labels are drawn
// separately because BC's checkbox renderer assumes a 100px label offset.
function slotOptions(layout, options) {
    const width = layout.controlW / options.length;
    return options.map((value, index) => ({ value, rect: [layout.controlX + index * width, layout.y, width, ITEM_H] }));
}

// 說明框：左緣 200、右緣維持在 1900（跟頁面其他內容的右界一致）
const TOOLTIP_X = 100;
const TOOLTIP_W = 1800;

// bar：軌道與右側數值欄
const BAR_H = 20;         // 軌道高度
const BAR_TOP = 22;       // 軌道相對於該列 y 的位移（(64 - 20) / 2，讓軌道垂直置中）
const BAR_VAL_W = 110;    // 數值文字欄寬

// 導覽狀態
let currentCategory = null;   // null = 分類清單
let currentPage = 0;
let currentSection = 0;
let currentSetting = '';      // 目前選中的設定 key（顯示描述用）
const actionDone = new Set(); // 已點過的動作按鈕（顯示回饋文字）

// bar 拖曳狀態：滑鼠在軌道上按下時記住是哪一項，放開前每幀依目前滑鼠位置更新數值。
// key/def 分開存（而非只存 key）是因為拖曳中途 pageSlice() 可能已經翻頁，
// 仍要能拿到正確的 min/max/step 做 clampBar。
let dragKey = null;
let dragDef = null;
let dragLayout = null;

function settingsInCategory(category) {
    return Object.entries(DEFAULT_FEATURE_SETTINGS).filter(([key, def]) => def.category === category && key !== 'resetTheme' && !def.hidden);
}

function computeSections(category) {
    if (category === 'immersion') return IMMERSION_SECTIONS.map(keys => keys.map(key => [key, DEFAULT_FEATURE_SETTINGS[key]]));
    const sections = [];
    let current = [];
    for (const entry of settingsInCategory(category)) {
        if (entry[1].sectionBreakBefore && current.length) { sections.push(current); current = []; }
        current.push(entry);
    }
    if (current.length) sections.push(current);
    return sections.length ? sections : [[]];
}

const SECTION_LABELS = {
    ui: ['settings_tab_ui', 'settings_tab_ui_colors'],
    theme: ['settings_tab_theme_basic', 'settings_tab_theme_advanced', 'settings_tab_theme_saved'],
    immersion: ['settings_tab_immersion_expressions', 'settings_tab_immersion_chat', 'settings_tab_immersion_other'],
};

function visibleSettings() {
    if (PANEL_CATEGORIES.has(currentCategory)) {
        const sections = computeSections(currentCategory);
        return sections[Math.min(currentSection, sections.length - 1)] || [];
    }
    return pageSlice(currentCategory);
}

function settingLayouts() {
    const entries = visibleSettings();
    if (!PANEL_CATEGORIES.has(currentCategory)) {
        return entries.map((entry, index) => ({ entry, x: 300, y: Y_START + index * Y_INC, width: 1200, controlX: SEL_OFFSET, controlW: SEL_WIDTH }));
    }
    const splitKey = currentCategory === 'immersion'
        ? (currentSection === 1 ? 'antiGarble' : currentSection === 2 ? 'petsuitAnimation' : null) : null;
    const splitIndex = splitKey ? entries.findIndex(([key]) => key === splitKey) : -1;
    const splitColumns = splitIndex >= 0;
    const rows = currentCategory === 'theme' && currentSection === 0 ? 5 : PANEL_ROWS;
    const columns = splitColumns ? 2 : Math.max(1, Math.ceil(entries.length / rows));
    const columnW = PANEL_W / columns;
    return entries.map((entry, index) => {
        const column = splitColumns ? (index >= splitIndex ? 1 : 0) : Math.floor(index / rows);
        const row = splitColumns ? (column ? index - splitIndex : index) : index % rows;
        const x = PANEL_X + 15 + column * columnW;
        const width = columnW - 30;
        const totalControlW = columns === 1 ? SEL_WIDTH : Math.max(190, Math.min(320, width * 0.48));
        const trailing = entry[1].type === 'bar' ? BAR_VAL_W + SOUND_GAP : 0;
        const controlW = totalControlW - trailing;
        return { entry, x, y: 270 + row * Y_INC, width, controlX: x + width - totalControlW, controlW };
    });
}

function homeItems() {
    return [...CATEGORIES.map(category => ({ type: 'category', category, label: T('cat_' + category) })),
        { type: 'domains', label: T('trusted_domains_title') }];
}

function homeRect(index) {
    return [HOME_COLUMNS[Math.floor(index / HOME_ITEMS_PER_COLUMN)], Y_START + (index % HOME_ITEMS_PER_COLUMN) * Y_INC, 400, ITEM_H];
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
    closeSettingDropdown();
    currentCategory = null;
    currentPage = 0;
    currentSection = 0;
    currentSetting = '';
    actionDone.clear();
    stopBarDrag();
}

function exit() {
    closeSettingDropdown();
    closeStorageManager();
    closeTrustedDomainManager();
    saveFeatureSettings();
    stopBarDrag();
    if (typeof PreferenceSubscreenExtensionsClear === 'function') PreferenceSubscreenExtensionsClear();
}

function run() {
    const ctx = window.MainCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.textAlign = 'left';

    // 拖曳中：每幀依最新滑鼠位置更新值（放開滑鼠由全域 mouseup 監聽器處理，見 installSettingsPage）。
    if (dragKey) applyDraggedBarValue();

    const panelTitle = currentCategory ? T('cat_' + currentCategory) : isStorageManagerOpen() ? T('storage_title') : isTrustedDomainManagerOpen() ? T('trusted_domains_title') : null;
    const title = panelTitle ? `${T('lce_settings_title')} — ${panelTitle}` : T('lce_settings_title');
    DrawText(title, 300, 125, 'Black', 'Gray');
    DrawButton(...HEADER_RECTS.exit, '', 'White', 'Icons/Exit.png');
    if (PANEL_CATEGORIES.has(currentCategory)) {
        DrawButton(...HEADER_RECTS.reset, '', 'White', 'Icons/Reset.png', T(currentCategory === 'theme' ? 's_resetTheme' : `settings_reset_${currentCategory}`));
    }
    DrawButton(...HEADER_RECTS.language, '', 'White');
    ctx.save();
    ctx.font = '48px "Twemoji Country Flags", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fSettings.themeEnabled ? uiColor('themeTextColor') : 'Black';
    const flags = window.Liko?.__Sys_Flags__;
    const country = flags?.forLanguage(currentGameLanguage());
    if (!country || !flags.draw(ctx, country, HEADER_RECTS.language[0] + 13, HEADER_RECTS.language[1] + 21, 64, 48)) {
        ctx.fillText(langFlag(currentGameLanguage()), HEADER_RECTS.language[0] + 45, HEADER_RECTS.language[1] + 45);
    }
    ctx.restore();
    if (isStorageManagerOpen()) positionStorageManager();
    if (isTrustedDomainManagerOpen()) positionTrustedDomainManager();

    if (!currentCategory) {
        homeItems().forEach((item, index) => {
            const [x, y, width, height] = homeRect(index);
            DrawButton(x, y, width, height, '', 'White');
            DrawTextFit(item.label, x + 10, y + height / 2, width - 20, 'Black');
        });
        ctx.textAlign = 'center';
        return;
    }

    if (PANEL_CATEGORIES.has(currentCategory)) {
        DrawEmptyRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 'Black', 3);
        const sections = computeSections(currentCategory);
        const labels = SECTION_LABELS[currentCategory];
        const tabW = PANEL_W / sections.length;
        centered(() => sections.forEach((_, index) => {
            const x = PANEL_X + index * tabW;
            DrawButton(x, PANEL_Y, tabW, ITEM_H, T(labels[index]), currentSection === index ? (fSettings.themeEnabled ? '%accent' : '#b98be0') : 'White');
        }));
    } else {
        DrawText(T('lce_click_hint'), 300, 190, 'Gray', 'Silver');
    }

    for (const layout of settingLayouts()) {
        const [key, def] = layout.entry;
        const { x, y, width, controlX, controlW } = layout;
        const disabled = !!def.disabled?.(fSettings);
        const hovered = !disabled && MouseIn(x, y, width, ITEM_H);
        if (hovered) {
            const alpha = ctx.globalAlpha;
            try {
                ctx.globalAlpha = 0.14;
                DrawRect(x - 4, y - 2, width + 8, ITEM_H + 4, 'Cyan');
            } finally { ctx.globalAlpha = alpha; }
        }
        const highlight = currentSetting === key ? 'Red' : 'Black';

        if (key === 'themeSlot') {
            DrawTextFit(T(def.label), x + 70, y + ITEM_H / 2, Math.max(80, controlX - x - 85), highlight, 'Gray');
            for (const { value, rect: [left, top, optionW] } of slotOptions(layout, def.options)) {
                DrawButton(left + 6, top + 12, 40, 40, '', disabled ? '#ebebe4' : 'White', '', '', disabled);
                if (fSettings[key] === value) {
                    DrawRect(left + 16, top + 22, 20, 20, fSettings.themeEnabled ? '%accent' : '#7214ff');
                }
                centered(() => DrawTextFit(value, left + 46 + (optionW - 52) / 2, top + ITEM_H / 2, optionW - 52, disabled ? 'Gray' : highlight));
            }
        } else if (def.type === 'checkbox') {
            DrawCheckbox(x, y, ITEM_H, ITEM_H, '', !!fSettings[key], disabled, highlight);
            DrawTextFit(T(def.label), x + ITEM_H + 10, y + ITEM_H / 2, width - ITEM_H - 20, highlight, 'Gray');
        } else if (def.withToggle) {
            // 左側勾選箱 + 右側控制項（關閉時右側停用）
            const enabled = !!fSettings[`${key}Enabled`];
            DrawCheckbox(x, y, ITEM_H, ITEM_H, '', enabled, disabled, highlight);
            DrawTextFit(T(def.label), x + ITEM_H + 10, y + ITEM_H / 2, Math.max(80, controlX - x - ITEM_H - 25), highlight, 'Gray');
            const ctrlDisabled = disabled || !enabled;
            if (def.type === 'select') {
                drawSelectControl(key, def, layout, ctrlDisabled);
            } else if (def.type === 'bar') {
                drawBarControl(key, def, layout, ctrlDisabled);
            } else { // input
                drawInputControl(key, def, layout, ctrlDisabled);
            }
            if (def.withSound) drawSoundToggle(key, layout, ctrlDisabled);
            if ((key === 'friendOnlineNotify' || key === 'friendOfflineNotify') && !ctrlDisabled && (fSettings[key] === 'message' || fSettings[key] === 'both')) drawNotifyDuration(key, y);
        } else if (def.type === 'select') {
            DrawTextFit(T(def.label), x + 70, y + ITEM_H / 2, Math.max(80, controlX - x - 85), highlight, 'Gray');
            drawSelectControl(key, def, layout, disabled);
        } else if (def.type === 'bar') {
            DrawTextFit(T(def.label), x + 70, y + ITEM_H / 2, Math.max(80, controlX - x - 85), highlight, 'Gray');
            drawBarControl(key, def, layout, disabled);
        } else if (def.type === 'input') {
            DrawTextFit(T(def.label), x + 70, y + ITEM_H / 2, Math.max(80, controlX - x - 85), highlight, 'Gray');
            drawInputControl(key, def, layout, disabled);
        } else if (def.type === 'action') {
            const caption = actionDone.has(key) ? T(def.actionDoneLabel) : T(def.label);
            centered(() => DrawButton(x, y, Math.min(ACTION_W, width), ITEM_H, caption, disabled ? '#ebebe4' : 'White', '', '', disabled));
        }
    }

    // 描述說明框。左緣從 300 移到 200、寬度補回 100 讓右緣仍停在 1900 ——
    // 說明文字是靠 DrawTextFit 縮字來塞進框裡的，框愈窄字就被壓得愈小愈難讀。
    if (currentSetting && DEFAULT_FEATURE_SETTINGS[currentSetting]) {
        drawTooltip(TOOLTIP_X, TOOLTIP_Y, TOOLTIP_W, T(DEFAULT_FEATURE_SETTINGS[currentSetting].desc));
    }

    if (!PANEL_CATEGORIES.has(currentCategory) && pageCount(currentCategory) > 1) {
        DrawText(`${currentPage + 1} / ${pageCount(currentCategory)}`, 1700, 230, 'Black', 'Gray');
        DrawButton(1815, 180, 90, 90, '', 'White', 'Icons/Next.png');
    }
    ctx.textAlign = 'center';
}

function click() {
    closeSettingDropdown();
    if (MouseIn(...HEADER_RECTS.exit)) {
        if (isStorageManagerOpen()) { closeStorageManager(); }
        else if (isTrustedDomainManagerOpen()) { closeTrustedDomainManager(); }
        else if (currentCategory === null) { exit(); }
        else { currentCategory = null; currentSetting = ''; }
        return;
    }

    if (MouseIn(...HEADER_RECTS.language)) {
        const [x, y, width, height] = HEADER_RECTS.language;
        openLanguageDropdown({ right: x + width, y: y + height, width: 320 });
        return;
    }
    if (PANEL_CATEGORIES.has(currentCategory) && MouseIn(...HEADER_RECTS.reset)) {
        if (currentCategory !== 'theme') {
            const defaults = defaultValues();
            const patch = {};
            for (const [key, def] of settingsInCategory(currentCategory)) {
                if (def.type === 'action') continue;
                patch[key] = defaults[key];
                if (def.withToggle) patch[`${key}Enabled`] = defaults[`${key}Enabled`];
                if (def.withSound) patch[`${key}Sound`] = defaults[`${key}Sound`];
            }
            updateSettings(patch);
        } else {
            runSettingAction('resetTheme');
        }
        return;
    }

    if (currentCategory === null) {
        const items = homeItems();
        for (let index = 0; index < items.length; index++) {
            if (!MouseIn(...homeRect(index))) continue;
            const item = items[index];
            if (item.type === 'domains') openTrustedDomainManager();
            else if (item.category === 'storage') openStorageManager();
            else { currentCategory = item.category; currentPage = 0; currentSection = 0; currentSetting = ''; }
            return;
        }
        return;
    }

    if (PANEL_CATEGORIES.has(currentCategory)) {
        const sections = computeSections(currentCategory);
        const tabW = PANEL_W / sections.length;
        for (let index = 0; index < sections.length; index++) {
            if (!MouseIn(PANEL_X + index * tabW, PANEL_Y, tabW, ITEM_H)) continue;
            currentSection = index; currentSetting = ''; stopBarDrag(); return;
        }
    }

    if (!PANEL_CATEGORIES.has(currentCategory) && MouseIn(1815, 180, 90, 90) && pageCount(currentCategory) > 1) {
        currentPage = (currentPage + 1) % pageCount(currentCategory);
        return;
    }

    for (const layout of settingLayouts()) {
        const [key, def] = layout.entry;
        const { x, y, width } = layout;
        const disabled = !!def.disabled?.(fSettings);

        if (key === 'themeSlot') {
            if (!disabled) for (const { value, rect } of slotOptions(layout, def.options)) {
                if (MouseIn(...rect)) setFeature(key, value);
            }
        } else if (def.type === 'checkbox') {
            if (MouseIn(x, y, ITEM_H, ITEM_H) && !disabled) { setFeature(key, !fSettings[key]); }
        } else if (def.withToggle) {
            const enabled = !!fSettings[`${key}Enabled`];
            if (MouseIn(x, y, ITEM_H, ITEM_H) && !disabled) {
                setFeature(`${key}Enabled`, !enabled);
            } else if (enabled && !disabled) {
                const durationKey = key === 'friendOnlineNotify' ? 'friendOnlineNotifyDuration' : key === 'friendOfflineNotify' ? 'friendOfflineNotifyDuration' : null;
                if (durationKey && (fSettings[key] === 'message' || fSettings[key] === 'both') && MouseIn(NOTIFY_DURATION_X, layout.y, NOTIFY_DURATION_W, ITEM_H)) { editNotifyDuration(key, layout.y);
                } else if (def.withSound && MouseIn(...soundRect(layout))) {
                    setFeature(`${key}Sound`, !fSettings[`${key}Sound`]);
                } else {
                    adjustControl(key, def, layout);
                }
            }
        } else if (def.type === 'select' && !disabled) {
            adjustControl(key, def, layout);
        } else if (def.type === 'bar' && !disabled) {
            handleBarClick(key, def, layout);
        } else if (def.type === 'input' && !disabled) {
            handleInputClick(key, def, layout);
        } else if (def.type === 'action' && !disabled) {
            if (MouseIn(x, y, Math.min(ACTION_W, width), ITEM_H)) { if (runSettingAction(key)) actionDone.add(key); }
        }

        if (MouseIn(x, y, width, ITEM_H)) currentSetting = key;
    }

}

function adjustControl(key, def, layout) {
    if (def.type === 'select') {
        if (def.dropdown) {
            if (MouseIn(layout.controlX, layout.y, layout.controlW, ITEM_H)) openSettingDropdown(key, def, layout);
            return;
        }
        const seg = layout.controlW / 2;
        const idx = def.options.indexOf(fSettings[key]);
        const len = def.options.length;
        if (MouseIn(layout.controlX + seg, layout.y, seg, ITEM_H)) { setFeature(key, def.options[(idx + 1 + len) % len]); }
        else if (MouseIn(layout.controlX, layout.y, seg, ITEM_H)) { setFeature(key, def.options[(idx - 1 + len) % len]); }
    } else if (def.type === 'bar') {
        handleBarClick(key, def, layout);
    } else if (def.type === 'input') {
        handleInputClick(key, def, layout);
    }
}

function drawSelectControl(key, def, { controlX, controlW, y }, disabled) {
    centered(() => {
        if (def.dropdown) {
            DrawButton(controlX, y, controlW, ITEM_H, `${selDisplay(def, fSettings[key])} ▾`, disabled ? '#ebebe4' : 'White', '', '', disabled);
            return;
        }
        const idx = def.options.indexOf(fSettings[key]), len = def.options.length;
        DrawBackNextButton(controlX, y, controlW, ITEM_H, selDisplay(def, fSettings[key]), disabled ? '#ebebe4' : 'White', '',
            () => selDisplay(def, def.options[(idx - 1 + len) % len]),
            () => selDisplay(def, def.options[(idx + 1 + len) % len]), disabled);
    });
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
const soundRect = ({ controlX, controlW, y }) => [controlX + controlW + SOUND_GAP, y, SOUND_W, ITEM_H];
function durationKeyForNotify(key) {
    return key === 'friendOnlineNotify' ? 'friendOnlineNotifyDuration' : 'friendOfflineNotifyDuration';
}
function removeNotifyDurationInput(save = true) {
    if (!notifyDurationInput) return;
    if (save && notifyDurationInputKey) commitNotifyDurationInput();
    notifyDurationInput.remove();
    notifyDurationInput = null;
    notifyDurationInputKey = null;
}
function positionNotifyDurationInput() {
    if (!notifyDurationInput) return;
    const canvas = window.MainCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / (canvas.width || 2000);
    const sy = rect.height / (canvas.height || 1000);
    const y = notifyDurationInput.dataset.y ? Number(notifyDurationInput.dataset.y) : 0;
    Object.assign(notifyDurationInput.style, {
        left: `${rect.left + NOTIFY_DURATION_X * sx}px`,
        top: `${rect.top + y * sy}px`,
        width: `${NOTIFY_DURATION_W * sx}px`,
        height: `${ITEM_H * sy}px`,
        fontSize: `${Math.max(12, 22 * sy)}px`,
    });
}
function commitNotifyDurationInput() {
    if (!notifyDurationInput || !notifyDurationInputKey) return;
    const raw = String(notifyDurationInput.value ?? '').trim();
    if (!/^\d{1,3}$/.test(raw)) {
        notifyDurationInput.value = String(Math.max(0, Math.min(999, Number(fSettings[notifyDurationInputKey]) || 5)));
        return;
    }
    const n = Math.max(0, Math.min(999, Number(raw)));
    setFeature(notifyDurationInputKey, String(n));
    notifyDurationInput.value = String(n);
}
function editNotifyDuration(key, y) {
    const dk = durationKeyForNotify(key);
    if (notifyDurationInput && notifyDurationInputKey === dk) {
        notifyDurationInput.focus();
        notifyDurationInput.select();
        return;
    }
    removeNotifyDurationInput();
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 3;
    input.value = String(Math.max(0, Math.min(999, Number(fSettings[dk]) || 5)));
    input.dataset.y = String(y);
    input.setAttribute('aria-label', T('s_friendNotifyDuration'));
    Object.assign(input.style, {
        position: 'fixed', zIndex: '10001', boxSizing: 'border-box',
        textAlign: 'center', border: '2px solid #7214ff', borderRadius: '4px',
        background: '#fff', color: '#000', padding: '2px 4px', outline: 'none',
        fontFamily: 'Arial, sans-serif', fontWeight: '700',
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commitNotifyDurationInput(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); removeNotifyDurationInput(false); }
        else if (!/[0-9]/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key) && !(e.ctrlKey || e.metaKey)) e.preventDefault();
    });
    input.addEventListener('input', () => {
        const clean = input.value.replace(/\D/g, '').slice(0, 3);
        input.value = clean;
    });
    input.addEventListener('blur', () => { commitNotifyDurationInput(); setTimeout(() => removeNotifyDurationInput(false), 0); });
    document.body.appendChild(input);
    notifyDurationInput = input;
    notifyDurationInputKey = dk;
    positionNotifyDurationInput();
    input.focus();
    input.select();
}
function drawNotifyDuration(key, y) {
    const dk = durationKeyForNotify(key);
    const v = Math.max(0, Math.min(999, Number(fSettings[dk]) || 0));
    if (!notifyDurationInput || notifyDurationInputKey !== dk) {
        DrawButton(NOTIFY_DURATION_X, y, NOTIFY_DURATION_W, ITEM_H, String(v), 'White');
    } else {
        notifyDurationInput.dataset.y = String(y);
        positionNotifyDurationInput();
    }
    DrawText(T('unit_seconds'), NOTIFY_DURATION_UNIT_X, y + 33, 'Black', 'Gray');
}

/** 音效開關：Icons/Audio2=有聲、Icons/Audio0=靜音。 */
function drawSoundToggle(key, layout, disabled) {
    const on = !!fSettings[`${key}Sound`];
    DrawButton(...soundRect(layout), '', disabled ? '#ebebe4' : 'White',
        on ? 'Icons/Audio2.png' : 'Icons/Audio0.png',
        T(on ? 'sound_on' : 'sound_off'), disabled);
}

/**
 * 繪製 bar 控制項：軌道 + 已填滿的部分 + 拉桿，右側附目前數值。
 * 顏色刻意沿用染色引擎已經涵蓋的幾種（White / Black / #3575b5 = themeEquipped），
 * 主題開啟時會跟著變，不必在這裡自己查主題色。
 */
function drawBarControl(key, def, layout, disabled) {
    const { controlX, controlW, y } = layout;
    const v = clampBar(def, fSettings[key]);
    const ratio = (v - def.min) / (def.max - def.min);
    const top = y + BAR_TOP;

    DrawRect(controlX, top, controlW, BAR_H, disabled ? '#ebebe4' : 'White');
    if (ratio > 0) DrawRect(controlX, top, controlW * ratio, BAR_H, disabled ? '#c8c8c0' : '#3575b5');
    DrawEmptyRect(controlX, top, controlW, BAR_H, 'Black', 2);

    // 拉桿：夾在軌道內，兩端才不會畫到軌道外面。拖曳中加寬、換色，給個明確的「抓住了」回饋。
    const dragging = !disabled && key === dragKey;
    const handleW = dragging ? 16 : 12;
    const hx = controlX + Math.max(6, Math.min(controlW - 6, controlW * ratio));
    DrawRect(hx - handleW / 2, y + 10, handleW, 44, disabled ? '#c8c8c0' : (dragging ? '#3575b5' : 'Black'));

    centered(() => DrawTextFit(String(v), controlX + controlW + SOUND_GAP + BAR_VAL_W / 2, y + 33,
        BAR_VAL_W, disabled ? 'Gray' : 'Black'));
}

/** 依目前 SEL_OFFSET~SEL_OFFSET+SEL_WIDTH 內的滑鼠位置算出 bar 的值（不檢查是否在列內）。 */
function barValueFromMouseX(def, layout) {
    const ratio = (MouseX - layout.controlX) / layout.controlW;
    return clampBar(def, def.min + ratio * (def.max - def.min));
}

/** 點擊 bar：點到哪就跳到哪一格（依 step 對齊）。整列 64 高都算，不必精準點在軌道上。 */
function handleBarClick(key, def, layout) {
    if (!MouseIn(layout.controlX, layout.y, layout.controlW, ITEM_H)) return;
    const next = barValueFromMouseX(def, layout);
    if (next !== fSettings[key]) { setFeature(key, next); }
}

/**
 * 開始拖曳：滑鼠在某個 bar 的軌道列（SEL_OFFSET~+SEL_WIDTH、整列 64 高）按下時呼叫。
 * 立刻套用一次目前位置的值，讓「按下不放直接拖」跟「點一下」手感一致，
 * 之後每幀（見 run() 開頭）依最新滑鼠位置持續更新，直到放開滑鼠。
 */
function startBarDrag(key, def, layout) {
    dragKey = key;
    dragDef = def;
    dragLayout = layout;
    applyDraggedBarValue();
}

/** 拖曳中依目前滑鼠位置更新值；放開滑鼠、或滑鼠已離開頁面座標系（拖到畫面外）時仍持續依最後位置夾住。 */
function applyDraggedBarValue() {
    if (!dragKey || !dragDef || typeof MouseX !== 'number') return;
    const next = barValueFromMouseX(dragDef, dragLayout);
    if (next !== fSettings[dragKey]) { setFeature(dragKey, next, { persist: false }); }
}

function stopBarDrag() {
    if (dragKey) saveFeatureSettings();
    dragKey = null;
    dragDef = null;
    dragLayout = null;
}

/** 這個 bar 目前是否可操作（未停用、withToggle 時左側勾選箱已開）。 */
function isBarDraggable(key, def) {
    if (def.type !== 'bar') return false;
    if (def.disabled?.(fSettings)) return false;
    if (def.withToggle) return !!fSettings[`${key}Enabled`];
    return true;
}

/**
 * 全域 mousedown：只在 LCE 設定頁「已進入某分類」時作用（currentCategory 非 null，
 * 跟 keyHandler 的 Escape 判斷同一招）。命中某個可操作 bar 的整列範圍就開始拖曳。
 * 用 capture 掛在 window 上，不 stopPropagation / preventDefault —— 讓 BC 原生的
 * click() 照樣在放開滑鼠時觸發，兩邊算出來的值本來就該一致，不需要互相攔截。
 */
function onGlobalMouseDown() {
    if (currentCategory === null) return;
    for (const layout of settingLayouts()) {
        const [key, def] = layout.entry;
        if (isBarDraggable(key, def) && MouseIn(layout.controlX, layout.y, layout.controlW, ITEM_H)) {
            startBarDrag(key, def, layout);
            return;
        }
    }
}

function onGlobalMouseUp() {
    stopBarDrag();
}

/** 繪製 input 控制項：色彩型別 → 十六進位欄位 + 齊平色塊；其餘 → 一般數值鈕。 */
function drawInputControl(key, def, layout, disabled) {
    const { controlX, controlW, y } = layout;
    centered(() => {
        if (def.subtype === 'color') {
            const swatchW = Math.min(SWATCH_W, controlW * 0.25);
            const hexW = controlW - swatchW;
            DrawButton(controlX, y, hexW, ITEM_H, String(fSettings[key] ?? ''), disabled ? '#ebebe4' : 'White', '', '', disabled);
            const val = fSettings[key];
            const col = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(val) ? val : '#000000';
            DrawButton(controlX + hexW, y, swatchW, ITEM_H, '', disabled ? '#ebebe4' : col, '', '', disabled);
        } else {
            // 字型欄位空白時顯示提示，讓使用者知道是點開下拉挑選的。
            // 語言欄位顯示的是語言碼對應的語言名（不是碼本身）。
            let shown;
            if (def.subtype === 'font' && !fSettings[key]) shown = T('themeFont_pick');
            else shown = String(fSettings[key] ?? '');
            DrawButton(controlX, y, controlW, ITEM_H, shown, disabled ? '#ebebe4' : 'White', '', '', disabled);
        }
    });
}

/** 點擊 input：色彩型別左側欄位=填色碼、右側色塊=叫出調色器；其餘=直接輸入。 */
function handleInputClick(key, def, layout) {
    const { controlX, controlW, y } = layout;
    if (def.subtype === 'color') {
        if (MouseIn(controlX, y, controlW, ITEM_H)) openColorPicker(key, def);
    } else if (def.subtype === 'font') {
        if (MouseIn(controlX, y, controlW, ITEM_H)) openFontPicker(key, def);
    } else if (MouseIn(controlX, y, controlW, ITEM_H)) {
        promptInput(key, def);
    }
}

// ───────────────────────────── 註冊 ─────────────────────────────

function keyHandler(e) {
    if (e.key === 'Escape' && isSettingDropdownOpen()) {
        closeSettingDropdown(); e.stopPropagation(); e.preventDefault(); return;
    }
    if (e.key === 'Escape' && currentCategory !== null) {
        currentCategory = null;
        currentSetting = '';
        stopBarDrag();
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
        // bar 拖曳：mousedown 判定命中哪一項並開始拖，mouseup 結束（見 onGlobalMouseDown/Up）。
        // 只在有 currentCategory 時才動作，離開 LCE 設定頁後這兩個監聽器什麼都不做，不必額外移除。
        window.addEventListener('mousedown', onGlobalMouseDown, true);
        window.addEventListener('mouseup', onGlobalMouseUp, true);
        window.addEventListener('touchend', onGlobalMouseUp, true);
        installed = true;
    })();
}
