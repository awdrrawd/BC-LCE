// ════════════════════════════════════════════════════════════════════════════
// 圖層隱藏（BETA）—— 移植 WCE layeringMenu.ts 的 layeringHide 功能
//
// 在 BC 原生的「分層(Layering)」選單裡，替「本來就會遮住其他部位」的物品加一組勾選框，
// 讓你自訂它到底要遮住哪些部位（例如讓外套不要遮住脖子）。設定存在物品的
// Property.wceOverrideHide —— 沿用 WCE 的欄位名與 ExtensionSettings.WCEOverrides 鍵，
// 裝過 WCE 的存檔可直接相容互通。
//
// 為什麼要把 wceOverrideHide 抽出來另存：這個私有欄位不該被寫進 BC 的外觀資料庫，
// 所以送出外觀前先從 appearance 抽走、改存到 ExtensionSettings.WCEOverrides（同 WCE），
// 載入外觀後再貼回 item.Property。呈現端靠 CharacterAppearanceVisible 的 patch ——
// 只有裝了 WCE 或 LCE（且開啟本功能）的人看得到效果，所以只對「宣告 layeringHide 能力」
// 的角色顯示設定框（能力經由打招呼協定互換，見 hello.js）。
//
// 只移植 layeringHide 這一項；WCE 同檔案的 copyColor（Paint）與 preventLayeringByOthers
// 不在本次規格內，未搬。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { injectStyle, removeStyle } from '../core/util.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const CAP = 'layeringHide';            // 能力名（沿用 WCE 的字串，才能與 WCE 使用者互通）
const OVERRIDE_KEY = 'WCEOverrides';   // ExtensionSettings 鍵（與 WCE 相同，勿改）
const HIDE_PROP = 'wceOverrideHide';   // item.Property 欄位（與 WCE 相同，勿改）
const STYLE_ID = 'lce-layering-hide';

// BC 原生的 #layering 是 CSS grid，grid-template 裡沒有「隱藏設定」用的兩列(header/grid)。
// 只把 header + 勾選表單塞進 root、卻不補這兩列的話，它們沒有 grid-area 可放 → 位置錯亂
// （這就是「按鈕座標怪怪的」的成因）。這段 CSS 移植自 WCE wceStyles，補上 layer-hide-header /
// layer-hide-grid 兩列並指派 grid-area，讓設定框落在圖層清單下方。
// 只在功能開啟時注入、關閉時移除，避免影響沒用這功能的人的分層選單版面。
const LAYERING_CSS = `
#layering {
    grid-template:
        "asset-header button-grid" min-content
        "asset-grid asset-grid" min-content
        "layer-header layer-header" min-content
        "layer-grid layer-grid" auto
        "layer-hide-header layer-hide-header" min-content
        "layer-hide-grid layer-hide-grid" auto
        / auto min-content;
}
#layering-button-grid { top: 0; position: sticky; }
#layering-hide-header { grid-area: layer-hide-header; }
#layering-wce-hide-div {
    box-sizing: border-box;
    grid-area: layer-hide-grid;
    width: 100%;
    height: calc(100% - min(2vh, 1vw));
    padding-left: min(2vh, 1vw);
    padding-right: min(2vh, 1vw);
    align-self: self-start;
}`;

/** 依設定注入/移除分層選單的版面 CSS。 */
function applyLayeringStyle() {
    if (getFeature(CAP)) injectStyle(STYLE_ID, LAYERING_CSS);
    else removeStyle(STYLE_ID);
}

let installed = false;

const parseJSON = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'layeringHide hook 未掛上:', name, e?.message ?? e); }
}

function patch(name, patches, hint) {
    try { modApi.patchFunction(name, patches); }
    catch (e) { console.warn(LOG, 'layeringHide patch 未套用:', name, hint ?? '', e?.message ?? e); }
}

/**
 * 依設定把 layeringHide 能力寫進 Player.BCECapabilities。
 * 有這個能力，設定框才會在「自己的物品」上顯示（UI 的能力判斷對象是 Layering.Character，
 * 編輯自己時就是 Player）。切換設定時也要即時更新並重新對房間報名，別人才會同步顯示效果。
 */
export function refreshLayeringCapability() {
    if (typeof Player === 'undefined' || !Player) return;
    if (!Array.isArray(Player.BCECapabilities)) Player.BCECapabilities = [];
    const has = Player.BCECapabilities.includes(CAP);
    const want = !!getFeature(CAP);
    if (want && !has) Player.BCECapabilities.push(CAP);
    else if (!want && has) Player.BCECapabilities = Player.BCECapabilities.filter(c => c !== CAP);
}

/** 送出外觀前把 wceOverrideHide 從 appearance 抽出、改存 ExtensionSettings（同 WCE serverAppearance）。 */
function stripOverridesForServer(appearance) {
    try {
        if (!Array.isArray(appearance)) return appearance;
        const overrides = { Hide: {} };
        for (const a of appearance) {
            if (Array.isArray(a?.Property?.[HIDE_PROP])) {
                const { [HIDE_PROP]: hide, ...property } = a.Property;
                overrides.Hide[a.Group] = hide;
                a.Property = property;
            }
        }
        if (typeof LZString !== 'undefined' && Player?.ExtensionSettings) {
            Player.ExtensionSettings[OVERRIDE_KEY] = LZString.compressToUTF16(JSON.stringify(overrides));
            if (typeof ServerPlayerExtensionSettingsSync === 'function') ServerPlayerExtensionSettingsSync(OVERRIDE_KEY);
        }
    } catch (e) { console.warn(LOG, 'layeringHide 外觀送出處理失敗:', e); }
    return appearance;
}

export function installLayeringHide() {
    if (installed) return;
    installed = true;

    refreshLayeringCapability();
    applyLayeringStyle();
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e.detail?.key !== CAP) return;
        refreshLayeringCapability();
        applyLayeringStyle();
        // 開/關後重新對房間報名，讓別人的 BCECapabilities 跟著更新（進而顯示/隱藏效果）。
        try {
            if (typeof ServerPlayerIsInChatRoom === 'function' && ServerPlayerIsInChatRoom()
                && typeof ChatRoomCharacterUpdate === 'function' && Player) {
                ChatRoomCharacterUpdate(Player);
            }
        } catch { /* ignore */ }
    });

    // ── 分層選單：加上「設定要遮住哪些部位」的勾選框 ──
    hook('Layering.Load', 10, (args, next) => {
        const ret = next(args);
        try {
            if (!getFeature(CAP) || CurrentScreen === 'Crafting') return ret;
            if (!Layering?.Character?.BCECapabilities?.includes(CAP)) return ret;
            const defaultItemHide = Layering.Asset?.Hide || [];
            if (defaultItemHide.length === 0) return ret;
            const overrideItemHide = Layering.Item?.Property?.[HIDE_PROP] || defaultItemHide;

            const root = document.getElementById(Layering.ID.root);
            if (!root) return ret;
            root.classList.add('scroll-box');
            root.querySelector('#layering-layer-div')?.classList.remove('scroll-box');

            ElementCreate({ tag: 'h1', attributes: { id: 'layering-hide-header' }, parent: root, children: [T('layeringHide_header')] });
            ElementCreate({
                tag: 'form',
                attributes: { id: 'layering-wce-hide-div' },
                classList: ['layering-layer-inner-grid'],
                parent: root,
                children: defaultItemHide.map(h => ({
                    tag: 'div',
                    classList: ['layering-pair'],
                    children: [
                        ElementCheckbox.Create(
                            `layering-wce-hide-cb-${h}`,
                            () => {
                                const hideForm = document.getElementById('layering-wce-hide-div');
                                if (!hideForm || !Layering.Item) return;
                                Layering.Item.Property ??= {};
                                Layering.Item.Property[HIDE_PROP] = new FormData(hideForm).getAll('checkbox-hide');
                                // 勾好勾滿（等於預設）就把 override 刪掉，回歸物品原本的 Hide，別佔空間。
                                if (defaultItemHide.length === Layering.Item.Property[HIDE_PROP].length) {
                                    delete Layering.Item.Property[HIDE_PROP];
                                }
                                Layering._CharacterRefresh(Layering.Character, false, false);
                            },
                            { value: h, disabled: Layering.Readonly, checked: overrideItemHide.includes(h) },
                            { checkbox: { attributes: { name: 'checkbox-hide' } } }
                        ),
                        { tag: 'span', classList: ['layering-pair-text'], children: [h] },
                    ],
                })),
            });
        } catch (e) { console.warn(LOG, 'layeringHide UI 建立失敗:', e); }
        return ret;
    });

    // 「重設」按鈕：清掉 override、把勾選框全部勾回（同 WCE _ResetClickListener）
    hook('Layering._ResetClickListener', 10, (args, next) => {
        try {
            if (getFeature(CAP) && CurrentScreen !== 'Crafting') {
                if (Layering?.Item?.Property) delete Layering.Item.Property[HIDE_PROP];
                document.querySelectorAll('input[name=checkbox-hide]').forEach((el) => { el.checked = true; });
            }
        } catch (e) { console.warn(LOG, 'layeringHide 重設失敗:', e); }
        return next(args);
    });

    // ── 讓 wceOverrideHide 真的生效：覆蓋 CharacterAppearanceVisible 的遮蔽判斷 ──
    // BC 把 item.Asset.Hide 寫死在函式內，只能用 patch 換成「有 override 就用 override」。
    // 與 WCE 同一段替換字串；若 WCE 也在（已先替換過），這裡找不到原字串會靜靜失敗，
    // 交由 WCE 那份處理即可，行為一致。
    patch('CharacterAppearanceVisible', {
        'if ((item.Asset.Hide != null) && (item.Asset.Hide.indexOf(GroupName) >= 0) && !Excluded) HidingItem = true;':
            `const hide = item.Property?.${HIDE_PROP} != null ? item.Property.${HIDE_PROP} : item.Asset.Hide;`
            + ' if ((hide != null) && (hide.indexOf(GroupName) >= 0) && !Excluded) HidingItem = true;',
    }, 'override item hide');

    // ── 送出外觀前把 override 抽出另存（避免寫進 BC 資料庫）──
    globalThis.lceServerAppearance = stripOverridesForServer;
    patch('ServerPlayerAppearanceSync', {
        'D.Appearance = ServerAppearanceBundle(Player.Appearance);':
            'D.Appearance = lceServerAppearance(ServerAppearanceBundle(Player.Appearance));',
    }, 'strip overrides before DB write');

    // ── 載入外觀後把 override 從 ExtensionSettings 貼回 item.Property ──
    hook('ServerAppearanceLoadFromBundle', 5, (args, next) => {
        const ret = next(args);
        try {
            const [C] = args;
            if (C?.IsPlayer?.() && Array.isArray(C.Appearance) && typeof LZString !== 'undefined') {
                let updated = false;
                const overrides = parseJSON(LZString.decompressFromUTF16(Player.ExtensionSettings?.[OVERRIDE_KEY] || ''));
                for (const [Group, Hide] of Object.entries(overrides?.Hide || {})) {
                    const item = InventoryGet(C, Group);
                    if (item && !Array.isArray(item.Property?.[HIDE_PROP])) {
                        item.Property ??= {};
                        item.Property[HIDE_PROP] = Hide;
                        updated = true;
                    }
                }
                if (updated && typeof ChatRoomCharacterUpdate === 'function') ChatRoomCharacterUpdate(C);
            }
        } catch (e) { console.warn(LOG, 'layeringHide 外觀載入還原失敗:', e); }
        return ret;
    });

    // 有人進房 / 離開偏好設定時，若自己身上有 override 就重送一次外觀，確保對方看得到效果（同 WCE）
    hook('ChatRoomSyncMemberJoin', 1, (args, next) => {
        const ret = next(args);
        try {
            if (Player?.Appearance?.some(a => Array.isArray(a?.Property?.[HIDE_PROP]))
                && typeof ChatRoomCharacterUpdate === 'function') ChatRoomCharacterUpdate(Player);
        } catch { /* ignore */ }
        return ret;
    });

    hook('PreferenceExit', 1, (args, next) => {
        const fromMain = typeof PreferenceSubscreen !== 'undefined' && PreferenceSubscreen?.name === 'Main';
        const ret = next(args);
        try {
            if (fromMain && Player?.Appearance?.some(a => Array.isArray(a?.Property?.[HIDE_PROP]))
                && typeof ChatRoomCharacterUpdate === 'function') ChatRoomCharacterUpdate(Player);
        } catch { /* ignore */ }
        return ret;
    });
}
