// ════════════════════════════════════════════════════════════════════════════
// 混合區／女性區快速切換（regionSwitch）—— 移植自 Liko - Region switch
//
// 在聊天搜尋畫面（ChatSearch）的房間導覽列加一顆按鈕，一鍵在「混合區(X)」與
// 「女性區(空字串)」之間切換並重新搜尋，省去進設定改區域再回來的來回。
//
// 區域選擇沿用外掛原本的儲存位置：Player.ExtensionSettings.RegionSwitch
// （值 "Mixed" / "FemaleOnly"），並用 ServerPlayerExtensionSettingsSync 逐鍵同步 ——
// 這樣獨立版外掛與 LCE 內建版讀寫的是同一份，兩邊可互換。舊版 localStorage 的
// ChatSearchSwitch_Zone 會一次性搬進 DB 後刪除。
//
// 無條件掛 hook，執行時才看 getFeature('regionSwitch') —— 與其他 LCE 功能一致，
// 切換設定即時生效、免重整。預設關閉。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const ES_KEY = 'RegionSwitch';              // Player.ExtensionSettings 的 key（與獨立版外掛相同）
const LS_KEY = 'ChatSearchSwitch_Zone';     // 舊版 localStorage key（僅供一次性搬移）
const BTN_ID = 'lce-region-switch-button';
const ICONS = {
    mixed: 'Icons/Gender.png',
    female: 'Screens/Online/ChatSelect/Female.png',
};

let inMixedZone = true;
let stateLoaded = false;
let switchButton = null;

const enabled = () => !!getFeature('regionSwitch');

function detectCurrentZone() {
    try {
        if (typeof Player !== 'undefined' && Player.ChatSearchSettings) {
            const space = Player.ChatSearchSettings.Space;
            if (space === 'X') return true;
            if (space === '') return false;
        }
    } catch (e) {
        console.warn(LOG, 'Region switch 無法判定區域:', e);
    }
    return true;
}

function saveZone() {
    try {
        if (typeof Player === 'undefined' || !Player) return;
        if (!Player.ExtensionSettings) Player.ExtensionSettings = {};
        Player.ExtensionSettings[ES_KEY] = inMixedZone ? 'Mixed' : 'FemaleOnly';
        // 逐鍵同步（dot-notation），不整包送 ExtensionSettings。
        if (typeof ServerPlayerExtensionSettingsSync === 'function') {
            ServerPlayerExtensionSettingsSync(ES_KEY);
        }
    } catch (e) {
        console.warn(LOG, 'Region switch 設定儲存失敗:', e?.message ?? e);
    }
}

/** 一次性搬移：舊的 localStorage 設定讀進來寫入 DB，成功後刪除原本的 key。 */
function migrateFromLocalStorage() {
    let legacy = null;
    try { legacy = localStorage.getItem(LS_KEY); } catch { return null; }
    if (legacy !== 'Mixed' && legacy !== 'FemaleOnly') return null;

    inMixedZone = legacy === 'Mixed';
    saveZone();
    if (Player?.ExtensionSettings?.[ES_KEY] === legacy) {
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        console.log(LOG, 'Region switch 設定已從 localStorage 搬移至 DB');
    }
    return legacy;
}

/** 讀取已存的區域選擇。ExtensionSettings 還沒就緒就先用當下畫面判定、且不標記已載入（下次再試）。 */
function loadSavedState() {
    if (stateLoaded) return;
    if (typeof Player === 'undefined' || !Player || Player.ExtensionSettings === undefined) {
        inMixedZone = detectCurrentZone();
        return;
    }
    const stored = Player.ExtensionSettings[ES_KEY] ?? migrateFromLocalStorage();
    inMixedZone = (stored === 'Mixed' || stored === 'FemaleOnly')
        ? stored === 'Mixed'
        : detectCurrentZone();
    stateLoaded = true;
}

function performSearch() {
    try {
        // 僅在聊天搜尋畫面且 InputSearch 元素存在時才搜尋。ChatSearchQuery 是非同步的，
        // 其伺服器回應會存取 InputSearch DOM；若此時元素已被移除，每個回傳房間都會噴一次
        // "missing element: InputSearch" 錯誤。
        if (typeof CurrentScreen === 'undefined' || CurrentScreen !== 'ChatSearch') return;
        if (!document.getElementById('InputSearch')) return;

        if (inMixedZone) {
            Player.ChatSearchSettings.Space = 'X';
            ChatSearchSpace = 'X';
        } else {
            Player.ChatSearchSettings.Space = '';
            ChatSearchSpace = '';
        }
        ChatSearchQuery(ChatSearchQueryString);
    } catch (e) {
        console.error(LOG, 'Region switch 搜索執行錯誤:', e);
    }
}

function switchZone() {
    inMixedZone = !inMixedZone;
    stateLoaded = true;
    saveZone();
    updateButtonAppearance();
    performSearch();
}

/** 按鈕永遠顯示「按下去會切到哪一區」：目前在混合區 → 顯示女性區圖示/提示。 */
function buttonTooltip() { return inMixedZone ? T('regionSwitch_toFemale') : T('regionSwitch_toMixed'); }
function buttonIcon()    { return inMixedZone ? ICONS.female : ICONS.mixed; }

function updateButtonAppearance() {
    if (!switchButton) return;
    const img = switchButton.querySelector('img');
    if (img) img.src = buttonIcon();
    const tooltipEl = switchButton.querySelector('.button-tooltip');
    if (tooltipEl) tooltipEl.textContent = buttonTooltip();
}

function removeButton() {
    const old = document.getElementById(BTN_ID);
    if (old) old.remove();
    switchButton = null;
}

function createSwitchButton() {
    if (!enabled()) return;
    if (typeof CurrentScreen === 'undefined' || CurrentScreen !== 'ChatSearch') return;

    const navSection = document.getElementById('chat-search-room-navigation-section');
    if (!navSection) return;

    removeButton();
    if (typeof ElementButton === 'undefined' || !ElementButton.Create) return;

    switchButton = ElementButton.Create(
        BTN_ID,
        switchZone,
        { tooltip: buttonTooltip(), tooltipPosition: 'bottom', image: buttonIcon() },
        { button: { classList: ['chat-search-room-button'] } },
    );

    const firstButton = navSection.querySelector('button');
    if (firstButton) navSection.insertBefore(switchButton, firstButton);
    else navSection.appendChild(switchButton);
}

let installed = false;

export function installRegionSwitch() {
    if (installed) return;
    installed = true;

    loadSavedState();   // 讀已存的區域（含一次性 localStorage 搬移）；未就緒時下次再試

    try {
        modApi.hookFunction('ChatSearchLoad', 1, (args, next) => {
            const result = next(args);
            if (!enabled()) { removeButton(); return result; }
            try {
                loadSavedState();
                inMixedZone = detectCurrentZone();
                Player.ChatSearchSettings.Space = inMixedZone ? 'X' : '';
                ChatSearchSpace = Player.ChatSearchSettings.Space;
                setTimeout(createSwitchButton, 50);
            } catch (e) {
                console.error(LOG, 'Region switch ChatSearchLoad hook 錯誤:', e);
            }
            return result;
        });

        modApi.hookFunction('ChatSearchRun', 1, (args, next) => {
            const result = next(args);
            if (!enabled()) { removeButton(); return result; }
            if (!document.getElementById(BTN_ID)) createSwitchButton();
            return result;
        });
    } catch (e) {
        console.warn(LOG, 'Region switch hook 未掛上:', e?.message ?? e);
    }
}
