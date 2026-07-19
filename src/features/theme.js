// ════════════════════════════════════════════════════════════════════════════
// 主題染色引擎 —— 移植 Themed 的 gui_redraw 系統（非自創的比對式染色）
//
// 機制（與 Themed 相同）：
//  1. DrawButton 不直接畫色，而是把顏色「重新編碼」成 @<狀態><原色>，交給 DrawRect /
//     DrawEmptyRect 解碼 → 所有按鈕都會走進主題，不管原本被寫死成什麼顏色。
//  2. DrawRect 解碼時：先處理 %語意色（%background/%hover/%disabled/%accent/%blocked…），
//     否則把任意 CSS 顏色解析成 hex，再用「BC 已知色 → 語意色」對照表換色；
//     最後依按鈕狀態 lighten/darken。
//  3. patchFunction 把 BC 原始碼裡寫死的顏色（"White"/"Cyan"/"#ebebe4"/"Gray"…）
//     換成 % 語意 token —— 這是「有些按鈕沒被染到」的真正解法。
//  4. 文字：黑字 → 主題文字色，並清掉陰影。
//  5. CSS：卷軸 / 選取 / 輸入框（canvas 之外的 HTML 元素）。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { plainColors, specialColors, composeColors, composeRootCss, getHexComputed, lighten, darken, isDark } from './theme-colors.js';

// BC 現在多數畫面是 HTML（設定九宮格、勾選框、下拉、卷軸、聊天室選單…），canvas hook 碰不到，
// 只能靠 CSS。以下樣式表移植自 Themed（變數前綴改為 --lce-），跳過其自有元件與 integrations。
import cssScrollbar from './styles/scrollbar.css?inline';
import cssSelection from './styles/selection.css?inline';
import cssInventory from './styles/inventory.css?inline';
import cssInputs from './styles/inputs.scss?inline';
import cssChat from './styles/chat.scss?inline';
import cssPreference from './styles/preference.scss?inline';
import cssChatSearch from './styles/chatroom_search.scss?inline';
import cssMisc from './styles/misc.scss?inline';
import cssFriendList from './styles/friendList.scss?inline';

const SHEETS = [cssScrollbar, cssSelection, cssInventory, cssInputs, cssChat, cssPreference, cssChatSearch, cssMisc, cssFriendList];

const STYLE_ID = 'lce-theme-style';
let hooked = false;
let patched = false;

// 顏色編碼符號（移植 Themed ColorType）
const C = { Base: '~', Hover: '-', Disabled: '=', Active: '+', NoDraw: '!', Custom: '%', FromButton: '@' };
const BUTTON_STATES = [C.Hover, C.Disabled, C.Base];

// 除錯用臨時覆蓋（/lceThemetest 浮球）：null = 依實際設定；true/false = 強制開/關。
// 只影響當下這次執行，不會寫進存檔 —— 收起浮球就還原成使用者真正的設定。
let themeDebugOverride = null;

/** 目前主題是否該生效：優先看除錯覆蓋，否則看實際設定。 */
export function isThemeActive() {
    return themeDebugOverride !== null ? themeDebugOverride : !!getFeature('themeEnabled');
}

/** 除錯浮球用：強制開/關主題（true/false），或還原成實際設定（null）。會立即重新套用。 */
export function setThemeDebugOverride(value) {
    themeDebugOverride = value;
    applyTheme();
}

/** 染色是否生效（移植 Themed doRedraw）。ClubCard 畫面不染，避免卡片配色被破壞。 */
function doRedraw() {
    return isThemeActive() && (typeof CurrentScreen === 'undefined' || CurrentScreen !== 'ClubCard');
}

// BC 常見的寫死色 → 語意色（移植自 Themed draw_rect.ts 的對照表）
const KNOWN = new Map([
    ['#eeeeee', 'element'], ['#dddddd', 'element'], ['#cccccc', 'element'], ['#ffffff', 'element'],
    ['#ffff88', 'element'], ['#d7f6e9', 'element'], ['#808080', 'element'],
    ['#00ffff', 'elementHover'],
    ['#ffc0cb', 'accent'], ['#ddffdd', 'accent'],
    ['#888888', 'elementDisabled'], ['#ebebe4', 'elementDisabled'],
]);

function drawRectRaw(next, l, t, w, h, color) { return next([l, t, w, h, color]); }

// ───────────────────────────── 套用 ─────────────────────────────

/**
 * 安裝染色引擎的繪圖 hook。**必須在啟動時無條件呼叫**，不能等主題開啟才掛：
 * ElementButton.Create 只在「建立當下」上色，若等到使用者中途開主題才掛 hook，
 * 那些早就建好的 HTML 按鈕（例如聊天室頂端選單）就再也不會被染到。
 * 每個 hook 內部都會用 doRedraw() 判斷，主題關閉時自動 passthrough，所以無條件掛是安全的。
 */
export function installThemeEngine() {
    // 先把色盤算出來：ElementButton.Create 這類 hook 是在「建立當下」讀 plainColors.accent，
    // 若還沒 composeColors 過，拿到的是空字串 → 那顆按鈕就不會上色。
    composeColors();
    installHooks();
}

export function applyTheme() {
    let style = document.getElementById(STYLE_ID);
    if (!isThemeActive()) {
        if (style) style.remove();
        document.body?.removeAttribute('data-lce-theme-type');
        // patch 會把 BC 原始碼的顏色換成 %token，而關閉時 DrawRect 是直接 passthrough，
        // token 會被當成無效顏色 → 必須把 patch 收回（同 Themed 的 toggleGuiPatches）。
        removePatches();
        return;
    }
    composeColors();
    if (!style) { style = document.createElement('style'); style.id = STYLE_ID; document.head.appendChild(style); }
    // :root 變數 + 移植自 Themed 的樣式表（涵蓋 HTML 的按鈕/文字/卷軸/輸入框/聊天/房間搜尋…）
    style.textContent = [composeRootCss(), ...SHEETS].join('\n');

    // 部分樣式依 body 的主題明暗切換圖示反相（Themed 的 data-tmd-theme-type 機制）
    if (document.body) document.body.dataset.lceThemeType = isDark(plainColors.main) ? 'dark' : 'light';

    installPatches();
}

// ───────────────────────────── 繪圖 hooks ─────────────────────────────

// 哪些圖示可以上色（移植 Themed utilities/drawing.ts 的 _Image 名單）：
// 角色素材、背景、場景圖不能碰；本身已有配色的圖示也排除。
const CANVAS_NO_PREFIX = ['Assets/Female3DCG/', 'Backgrounds/', 'Icons/Struggle/', 'Icons/LARP/', 'Icons/MagicBattle/', 'Screens/', 'http'];
const HTML_NO_PREFIX = [...CANVAS_NO_PREFIX, 'data:'];

const BASE_NO_FILES = [
    'Icons/Accept.png', 'Icons/Activity.png', 'Icons/Arousal.png', 'Icons/Audio.png', 'Icons/BlindToggle2.png',
    'Icons/Cancel.png', 'Icons/Cell.png', 'Icons/Checked.png', 'Icons/ClubCard.png', 'Icons/Controller.png',
    'Icons/Crafting.png', 'Icons/Exit.png', 'Icons/Explore.png', 'Icons/Gavel.png', 'Icons/Gender.png',
    'Icons/Infiltration.png', 'Icons/Lock.png', 'Icons/LockMenu.png', 'Icons/MagicSchool.png', 'Icons/Online.png',
    'Icons/Platform.png', 'Icons/Poker.png', 'Icons/Search.png', 'Icons/Security.png', 'Icons/ServiceBell.png',
    'Icons/Title.png', 'Icons/Use.png', 'Icons/WinkNone.png', 'Icons/Color.png', 'Icons/ColorChange.png',
    'Icons/ColorChangeMulti.png', 'Icons/Small/ColorBlocked.png', 'Icons/Small/ColorChange.png',
    'Icons/Small/ColorChangeMulti.png', 'Icons/Small/Naked.png', 'Icons/Small/Use.png', 'Icons/Small/YouTube.png',
];
const CANVAS_NO_FILES = new Set(BASE_NO_FILES);
const HTML_NO_FILES = new Set([
    ...BASE_NO_FILES,
    'Icons/Information.svg', 'Icons/CaretUp.svg', 'Icons/cross.svg',
    'Icons/RoomTypeNormal.svg', 'Icons/RoomTypeHybrid.svg', 'Icons/RoomTypeMap.svg',
    'Icons/Female.svg', 'Icons/Gender.svg', 'Icons/Male.svg',
]);

function canColorize(src, prefixes, files) {
    if (typeof src !== 'string' || !src) return false;
    if (prefixes.some(p => src.startsWith(p) || src.startsWith(`./${p}`))) return false;
    if (files.has(src)) return false;
    return true;
}
const doColorizeImage     = (src) => canColorize(src, CANVAS_NO_PREFIX, CANVAS_NO_FILES);
const doColorizeHTMLImage = (src) => canColorize(src, HTML_NO_PREFIX, HTML_NO_FILES);

/**
 * 逐一掛 hook：BC 版本差異可能讓某個函式不存在，modApi 會直接丟例外。
 * 各自包起來，避免一個失敗就讓後面全部沒掛上（那會變成「有些染有些沒染」的假象）。
 */
function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn('🐈‍⬛ [LCE] 主題 hook 未掛上（此 BC 版本可能沒有這個函式）:', name, e?.message ?? e); }
}

/** patch 同理：分開包，讓單一 patch 失效不影響其他。 */
function patch(name, patches) {
    try { modApi.patchFunction(name, patches); }
    catch (e) { console.warn('🐈‍⬛ [LCE] 主題 patch 未套用:', name, e?.message ?? e); }
}

function installHooks() {
    if (hooked) return;
    hooked = true;

    // HTML 按鈕的圖示上色（移植 Themed element_button_create.ts）
    if (typeof ElementButton === 'object' && typeof ElementButton?.Create === 'function') {
        hook('ElementButton.Create', 11, (args, next) => {
            if (!doRedraw()) return next(args);
            const options = args[2];
            if (!options || typeof options.image !== 'string') return next(args);
            if (!doColorizeHTMLImage(options.image)) return next(args);
            options.imageColor = plainColors.accent;
            return next(args);
        });
    }

    // 背景：MainCanvas 的底是 DrawRoomBackground 畫的圖（選單為 Sheet.jpg）
    hook('DrawRoomBackground', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const url = args[0];
        if (typeof url !== 'string' || !url.includes('Sheet.jpg')) return next(args);
        if (getFeature('themeFlatColor')) {
            DrawRect(0, 0, 2000, 1000, `${C.NoDraw}${plainColors.main}`);
            return;
        }
        next(args);
        MainCanvas.save();
        MainCanvas.globalCompositeOperation = 'multiply';
        DrawRect(0, 0, 2000, 1000, `${C.NoDraw}${plainColors.main}`);
        MainCanvas.restore();
    });

    // 按鈕：把顏色重新編碼後交給 DrawRect/DrawEmptyRect 解碼（移植 Themed draw_button.ts）
    hook('DrawButton', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [x, y, w, h, label, , image, hoveringText, isDisabled] = args;
        const isHovering = typeof MouseHovering === 'function' ? MouseHovering(x, y, w, h) : false;
        const state = isDisabled ? C.Disabled : (isHovering ? C.Hover : C.Base);
        const color = C.FromButton + state + args[5];

        if (typeof ControllerAddActiveArea === 'function') ControllerAddActiveArea(x, y);

        if (!isHovering && !isDisabled)      { DrawRect(x, y, w, h, color); DrawEmptyRect(x, y, w, h, `${C.Custom}border`, 2); }
        else if (isHovering && !isDisabled)  { DrawRect(x, y, w, h, color); DrawEmptyRect(x, y, w, h, `${C.Custom}hover`, 2); }
        else                                 { DrawRect(x, y, w, h, color); DrawEmptyRect(x, y, w, h, `${C.Custom}disabled`, 2); }

        DrawTextFit(label, x + w / 2, y + h / 2 + 1, w - 4, plainColors.text);
        if (image != null && image !== '') DrawImage(image, x + 2, y + 2);
        if (hoveringText != null && isHovering && typeof DrawHoverElements !== 'undefined') {
            DrawHoverElements.push(() => DrawButtonHover(x, y, w, h, hoveringText));
        }
    });

    // 勾選框：改用語意 token，並清掉文字陰影（移植 Themed draw_checkbox.ts）
    hook('DrawCheckbox', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [l, t, w, h, text, isChecked, disabled = false, textColor = 'Black', checkImage = 'Icons/Checked.png'] = args;
        DrawText(text, l + 100, t + 33, textColor, '');
        DrawButton(l, t, w, h, '', disabled ? `${C.Custom}disabled` : `${C.Custom}background`, isChecked ? checkImage : '', undefined, disabled);
    });

    // 矩形：解碼（移植 Themed draw_rect.ts）
    hook('DrawRect', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [l, t, w, h] = args;
        let color = args[4];
        if (typeof color !== 'string') return next(args);

        // ! 前綴 = 不要染（例如畫面閃光）
        if (color.startsWith(C.NoDraw)) return drawRectRaw(next, l, t, w, h, color.substring(1));

        const hover = (typeof MouseIn === 'function' && MouseIn(l, t, w, h)) ? 1 : 0;
        let state = color[0];
        if (color.startsWith(C.FromButton)) {
            color = color.substring(1);
            state = color[0];
            if (BUTTON_STATES.includes(state)) color = color.substring(1);
        }

        if (color.startsWith(C.Custom)) {
            const token = color.substring(1).toLowerCase();
            switch (token) {
                case 'disabled':   color = hover ? lighten(plainColors.elementDisabled, 0.2) : plainColors.elementDisabled; break;
                case 'hover':      color = plainColors.elementHover; break;
                case 'background': color = hover ? plainColors.elementHover : plainColors.element; break;
                case 'accent':     color = hover ? plainColors.accentHover : plainColors.accent; break;
                case 'allowed': case 'equipped': case 'crafted': case 'limited': case 'blocked':
                case 'invalid': case 'roomfriend': case 'roomblocked': case 'roomgame': {
                    const k = Object.keys(specialColors).find(s => s.toLowerCase() === token);
                    if (!k) return next(args);
                    color = specialColors[k][hover];
                    break;
                }
                default: return next(args);
            }
        } else {
            // 帶 alpha 的顏色不動（閃光/半透明遮罩）
            if (/^#[0-9a-f]{8}$/i.test(color.trim()) || color.trim().toLowerCase().startsWith('rgba')) return next(args);
            const parsed = getHexComputed(color);
            if (!parsed) return next(args);
            const semantic = KNOWN.get(parsed);
            if (semantic) color = plainColors[semantic];
        }

        if (BUTTON_STATES.includes(state)) {
            if (state === C.Hover) color = lighten(color, 0.2);
            else if (state === C.Disabled) color = darken(color, 0.2);
        }
        return drawRectRaw(next, l, t, w, h, color);
    });

    // 空心框（邊框）：解碼（移植 Themed draw_empty_rect.ts）
    hook('DrawEmptyRect', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [l, t, w, h, color, thickness] = args;
        if (typeof color !== 'string') return next(args);
        const paint = (c) => next([l, t, w, h, c, thickness ?? 2]);

        if (color.startsWith(C.Custom)) {
            switch (color.substring(1).toLowerCase()) {
                case 'border':   return paint(plainColors.accent);
                case 'hover':    return paint(plainColors.accentHover);
                case 'disabled': return paint(plainColors.accentDisabled);
                default:         return next(args);
            }
        }
        const parsed = getHexComputed(color);
        if (parsed === '#ffffff' || parsed === '#dddddd' || parsed === '#000000') return paint(plainColors.accent);
        return next(args);
    });

    // Canvas 圖示上色（移植 Themed draw_image_ex.ts）—— 這是圖示變成強調色的關鍵
    hook('DrawImageEx', 11, (args, next) => {
        if (!doRedraw() || typeof args[0] !== 'string') return next(args);
        if (!doColorizeImage(args[0])) return next(args);
        const [src, canvas, x, y] = args;
        const options = args[4] ?? {};
        options.HexColor = plainColors.accent.startsWith('#') ? plainColors.accent : `#${plainColors.accent}`;
        options.FullAlpha = true;
        return next([src, canvas, x, y, options]);
    });

    // 上/下頁鈕（更衣室每一列的 〈 項目 〉 就是這個）（移植 Themed draw_back_next_button.ts）
    hook('DrawBackNextButton', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [left, top, width, height, label, , image, , , disabled] = args;
        let [, , , , , , , backText, nextText, , arrowWidth] = args;
        if (arrowWidth == null || arrowWidth > width / 2) arrowWidth = width / 2;
        const leftSplit = left + arrowWidth;
        const rightSplit = left + width - arrowWidth;

        if (typeof ControllerAddActiveArea === 'function') {
            ControllerAddActiveArea(left, top);
            ControllerAddActiveArea(left + width - arrowWidth, top);
        }

        MainCanvas.save();
        MainCanvas.textAlign = 'center';
        MainCanvas.beginPath();
        MainCanvas.rect(left, top, width, height);
        MainCanvas.fillStyle = plainColors.element;
        MainCanvas.fillRect(left, top, width, height);
        if (MouseIn(left, top, width, height) && !CommonIsMobile && !disabled) {
            MainCanvas.fillStyle = plainColors.elementHover;
            if (MouseX > rightSplit) MainCanvas.fillRect(rightSplit, top, arrowWidth, height);
            else if (MouseX <= leftSplit) MainCanvas.fillRect(left, top, arrowWidth, height);
            else MainCanvas.fillRect(left + arrowWidth, top, width - arrowWidth * 2, height);
        } else if (CommonIsMobile && arrowWidth < width / 2 && !disabled) {
            MainCanvas.fillStyle = plainColors.elementDisabled;
            MainCanvas.fillRect(left, top, arrowWidth, height);
            MainCanvas.fillRect(rightSplit, top, arrowWidth, height);
        }
        MainCanvas.lineWidth = 2;
        MainCanvas.strokeStyle = plainColors.accent;
        MainCanvas.stroke();
        MainCanvas.closePath();

        // 用 'Black' 交給 DrawTextFit hook 換成主題文字色（與 Themed 最終呈現一致）
        DrawTextFit(label, left + width / 2, top + height / 2 + 1, CommonIsMobile ? width - 6 : width - 36, 'Black');
        if (image != null && image !== '') DrawImage(image, left + 2, top + 2);

        // 左右箭頭
        MainCanvas.strokeStyle = plainColors.accent;
        for (const [ax, bx, cx] of [[left + 15, left + 5, left + 15], [left + width - 15, left + width - 5, left + width - 15]]) {
            MainCanvas.beginPath();
            MainCanvas.moveTo(ax, top + height / 5);
            MainCanvas.lineTo(bx, top + height / 2);
            MainCanvas.lineTo(cx, top + height - height / 5);
            MainCanvas.stroke();
            MainCanvas.closePath();
        }
        MainCanvas.restore();

        if (CommonIsMobile) return;
        if (backText == null) backText = () => '';
        if (nextText == null) nextText = () => '';
        if (MouseX >= left && MouseX <= left + width && MouseY >= top && MouseY <= top + height && !disabled) {
            DrawHoverElements.push(() => DrawButtonHover(left, top, width, height, MouseX < leftSplit ? backText() : MouseX >= rightSplit ? nextText() : ''));
        }
    });

    // 物品預覽框（移植 Themed draw_preview_box.ts）
    hook('DrawPreviewBox', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [x, y, path, description, options] = args;
        const { Vibrating, Icons, Disabled } = options || {};
        let { Background } = options || {};
        const width = options?.Width || DrawAssetPreviewDefaultWidth;
        const height = options?.Height || DrawAssetPreviewDefaultHeight;
        const padding = 2;
        const textGutter = description ? 44 : 0;
        const hover = MouseHovering(x, y, width, height);

        Background = Background || (Disabled ? plainColors.elementDisabled : (hover ? plainColors.elementHover : plainColors.element));

        let imgX = x + padding, imgY = y + padding, imgW = width, imgH = height - textGutter;
        if (imgW > imgH) { const r = imgH / imgW; imgW *= r; imgX += (width - imgW) / 2; }
        else if (imgW < imgH) { const r = imgW / imgH; imgH *= r; imgY += (height - imgH - textGutter) / 2; }
        imgW -= 2 * padding; imgH -= 2 * padding;
        if (Vibrating) { imgX += 1 + Math.floor(Math.random() * 3); imgY += 1 + Math.floor(Math.random() * 3); }

        // 不加 C.NoDraw：Background 要「走一次 DrawRect 染色」才會被主題接手（同 Themed draw_preview_box）。
        // 這正是第三方 UI（LSCG 施法選單的法術卡用 DrawPreviewBox 傳 Background:"white"）被染到的關鍵 ——
        // 加了 ! 前綴會讓 DrawRect 直接照畫，白卡就永遠是白的、吃不到 element 色。
        // 落到預設值時 Background 本來就已是主題色（hex），再過一次 DrawRect 也只是原樣輸出，無副作用。
        DrawRect(x, y, width, height, Background);
        if (typeof ControllerAddActiveArea === 'function') ControllerAddActiveArea(x, y);
        DrawEmptyRect(x, y, width, height, hover ? plainColors.accentHover : plainColors.accent);
        if (path !== '') DrawImageResize(path, imgX, imgY, imgW, imgH);
        DrawPreviewIcons(Icons ?? [], x, y);
        if (description) DrawTextFit(description, x + width / 2, y + height - 25, width - 2 * padding, plainColors.text);
    });

    // 懸停提示框（移植 Themed draw_button_hover.ts）
    hook('DrawButtonHover', 11, (args, next) => {
        if (!doRedraw()) return next(args);
        const [, , width, height, hoveringText] = args;
        let [left, top] = args;
        if (hoveringText == null || hoveringText === '') return next(args);
        left = MouseX > 1000 ? left - 475 : left + width + 25;
        top = top + (height - 65) / 2;
        MainCanvas.save();
        MainCanvas.textAlign = 'center';
        DrawRect(left, top, 450, 65, `${C.NoDraw}${plainColors.elementHint}`);
        DrawEmptyRect(left, top, 450, 65, plainColors.accent, 2);
        DrawTextFit(hoveringText, left + 225, top + 33, 444, 'Black');
        MainCanvas.restore();
    });

    // 物品選單按鈕底色 → 語意 token（移植 Themed dialog_get_menu_button_color.ts）
    if (typeof DialogGetMenuButtonColor === 'function') {
        hook('DialogGetMenuButtonColor', 0, (args, next) => {
            if (!doRedraw()) return next(args);
            const [buttonName] = args;
            if (DialogIsMenuButtonDisabled(buttonName)) return `${C.Custom}disabled`;
            if (buttonName === 'ColorDefault') return DialogColorSelect || `${C.Custom}background`;
            return `${C.Custom}background`;
        });
    }

    // 更衣室預覽圖底色 → 狀態色（移植 Themed appearance_get_preview_image_color.ts）
    if (typeof AppearanceGetPreviewImageColor === 'function') {
        hook('AppearanceGetPreviewImageColor', 11, (args, next) => {
            if (!doRedraw()) return next(args);
            const [c, item, hover] = args;
            const i = hover ? 1 : 0;
            if (DialogMenuMode === 'permissions' && c.IsPlayer()) {
                let permission = 'allowed';
                if (InventoryIsPermissionBlocked(c, item.Asset.Name, item.Asset.Group.Name)) permission = 'blocked';
                else if (InventoryIsPermissionLimited(c, item.Asset.Name, item.Asset.Group.Name)) permission = 'limited';
                return item.Worn ? specialColors.equipped[i] : specialColors[permission][i];
            }
            const unusable = item.SortOrder.startsWith(DialogSortOrder.Unusable.toString())
                || item.SortOrder.startsWith(DialogSortOrder.TargetFavoriteUnusable.toString())
                || item.SortOrder.startsWith(DialogSortOrder.PlayerFavoriteUnusable.toString());
            const blocked = item.SortOrder.startsWith(DialogSortOrder.Blocked.toString());
            const limited = item.Icons.includes('AllowedLimited');
            if (blocked) return specialColors.blocked[i];
            if (item.Worn) return specialColors.equipped[i];
            if (item.Craft != null && item.Craft.Name != null) return specialColors.crafted[i];
            if (unusable) return plainColors.elementDisabled;
            if (limited) return specialColors.limited[i];
            return hover ? plainColors.elementHover : plainColors.element;
        });
    }

    // 文字：黑字 → 主題文字色，並清掉陰影（移植 Themed draw_text.ts / draw_text_fit.ts）
    hook('DrawText', 11, (args, next) => {
        if (!doRedraw() || !args[0] || !args[3]) return next(args);
        if (getHexComputed(args[3]) === '#000000') args[3] = plainColors.text;
        args[4] = '';
        return next(args);
    });

    hook('DrawTextFit', 11, (args, next) => {
        if (!doRedraw() || !args[0] || !args[4]) return next(args);
        if (getHexComputed(args[4]) === '#000000') args[4] = plainColors.text;
        return next(args);
    });

    hook('DrawTextWrap', 11, (args, next) => {
        if (!doRedraw() || !args[0]) return next(args);
        // DrawTextWrap(Text, X, Y, Width, Height, ForeColor, BackColor, MaxLine)
        if (args[5] && getHexComputed(args[5]) === '#000000') args[5] = plainColors.text;
        return next(args);
    });
}

// ───────────────────────────── 原始碼 patch ─────────────────────────────
// BC 把顏色寫死在函式裡（"White"/"Cyan"/"Gray"/"#ebebe4"…），光靠 hook 換不掉，
// 因為那些字串是在函式內部產生的。Themed 用 patchFunction 把它們換成 % 語意 token，
// 再由上面的 DrawRect 解碼 —— 這才是「所有按鈕都被染到」的關鍵。
// 有被 patch 的函式（關閉主題時要逐一收回）
const PATCHED_FNS = ['DrawProcessScreenFlash', 'ChatAdminRun', 'ExtendedItemGetButtonColor', 'DialogDraw', 'AppearanceRun', 'Shop2._AssetElementDraw'];

/** 收回所有 patch（主題關閉時），避免 %token 被當成真顏色送進 canvas。 */
function removePatches() {
    if (!patched) return;
    patched = false;
    for (const fn of PATCHED_FNS) {
        try { modApi.removePatches(fn); } catch { /* 函式不存在就略過 */ }
    }
}

function installPatches() {
    if (patched) return;
    patched = true;
    try {
        patch('DrawProcessScreenFlash', {
            'DrawRect(0, 0, 2000, 1000, "#ffffff" + DrawGetScreenFlashAlpha(FlashTime / Math.max(1, 4 - DrawLastDarkFactor)));':
                'DrawRect(0, 0, 2000, 1000, "!#ffffff" + DrawGetScreenFlashAlpha(FlashTime / Math.max(1, 4 - DrawLastDarkFactor)));',
            'DrawRect(0, 0, 2000, 1000, DrawScreenFlashColor + PinkFlashAlpha);':
                'DrawRect(0, 0, 2000, 1000, "!" + DrawScreenFlashColor + PinkFlashAlpha);',
        });

        patch('ChatAdminRun', {
            'const ButtonBackground = canEdit ? "White" : "#ebebe4";':
                'const ButtonBackground = canEdit ? "%background" : "%disabled";',
        });

        patch('ExtendedItemGetButtonColor', {
            'ButtonColor = "#888888";': 'ButtonColor = "%accent";',
            'ButtonColor = Hover ? "red" : "pink";': 'ButtonColor = "%blocked";',
            'ButtonColor = Hover ? "orange" : "#fed8b1";': 'ButtonColor = "%limited";',
            'ButtonColor = Hover ? "green" : "lime";': 'ButtonColor = "%allowed";',
            'ButtonColor = "Red";': 'ButtonColor = "%blocked";',
            'ButtonColor = "Pink";': 'ButtonColor = "%limited";',
            'ButtonColor = Hover ? "Cyan" : "LightGreen";': 'ButtonColor = "%allowed";',
            'ButtonColor = Hover ? "Cyan" : "White";': 'ButtonColor = Hover ? "%hover" : "%background";',
        });

        patch('DialogDraw', {
            'DrawRect(1087 + offset, 550, 225, 275, bgColor);':
                'DrawRect(1087 + offset, 550, 225, 275, disabled ? "%disabled" : (hover ? "%hover" : "%background"));DrawEmptyRect(1087 + offset, 550, 225, 275, "%border");',
            'const bgColor = disabled ? "Gray" : (hover ? "aqua" : "white");':
                'const bgColor = disabled ? "%disabled" : (hover ? "%hover" : "%background");',
        });

        // 更衣室：BC 把底色寫死在 AppearanceRun 裡，只能用 patch 換掉（這就是更衣室沒被染的原因）
        patch('AppearanceRun', {
            'const ButtonColor = canAccess ? "White" : "#888";':
                'const ButtonColor = canAccess ? "%background" : "%disabled";',
            'DrawButton(1635, 145 + (A - CharacterAppearanceOffset) * 95, 65, 65, "", layeringEnabled ? "#fff" : "#aaa", "Icons/Small/Layering.png", TextGet("Layering"), !layeringEnabled);':
                'DrawButton(1635, 145 + (A - CharacterAppearanceOffset) * 95, 65, 65, "", layeringEnabled ? "%background" : "%disabled", "Icons/Small/Layering.png", TextGet("Layering"), !layeringEnabled);',
            'DrawButton(1725, 145 + (A - CharacterAppearanceOffset) * 95, 160, 65, ColorButtonText, CanCycleColors ? ColorButtonColor : "#aaa", undefined, undefined, !CanCycleColors);':
                'DrawButton(1725, 145 + (A - CharacterAppearanceOffset) * 95, 160, 65, ColorButtonText, CanCycleColors ? ColorButtonColor : "%disabled", undefined, undefined, !CanCycleColors);',
            'DrawButton(1910, 145 + (A - CharacterAppearanceOffset) * 95, 65, 65, "", CanPickColor ? "#fff" : "#aaa", CanPickColor ? ColorIsSimple ? "Icons/Small/ColorChange.png" : "Icons/Small/ColorChangeMulti.png" : "Icons/Small/ColorBlocked.png", undefined, !CanPickColor);':
                'DrawButton(1910, 145 + (A - CharacterAppearanceOffset) * 95, 65, 65, "", CanPickColor ? "%background" : "%disabled", CanPickColor ? ColorIsSimple ? "Icons/Small/ColorChange.png" : "Icons/Small/ColorChangeMulti.png" : "Icons/Small/ColorBlocked.png", undefined, !CanPickColor);',
        });

        patch('Shop2._AssetElementDraw', {
            'options.Background = "cyan";':  'options.Background = "%hover";',
            'options.Background = "white";': 'options.Background = "%background";',
            'options.Background = "gray";':  'options.Background = "%disabled";',
            'options.Background = "pink";':  'options.Background = "%equipped";',
        });
    } catch (e) {
        console.warn('🐈‍⬛ [LCE] 主題 patch 套用失敗（BC 版本可能有變動）:', e);
    }
}
