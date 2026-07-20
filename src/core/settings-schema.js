// ════════════════════════════════════════════════════════════════════════════
// 功能設定 Schema（仿 WCE src/util/settings.ts 的 defaultSettings）
// 每一項描述一個設定：型別、預設值、所屬分類、停用條件、切換副作用。
//
//   label / desc / optionLabels / actionLabel… 都是 i18n key（見 core/i18n.js），
//   由設定頁透過 T() 翻譯後顯示，故此表不含硬編碼顯示字串。
//
//   disabled(s)                → 傳入目前設定物件，回傳 true 表示不可操作
//   sideEffects(newValue, init, s) → 值變更（或載入 init=true）時執行
//   type: 'checkbox' | 'select' | 'input' | 'bar' | 'action'
//     select 的 options 是實際儲存值，optionLabels 是平行的 i18n key（省略則直接顯示值）
//     bar 是數值滑桿，須填 min / max / step，值一律以數字儲存（見 clampBar）
//     action 沒有值，顯示成按鈕，點擊呼叫 run()
//   withToggle: true → 該 select/input 左側附一個勾選箱，狀態存於 `<key>Enabled`，
//                      關閉時右側控制項停用（見 settings-page.js）。toggleDefault 為其預設。
//   withSound: true  → 控制項右側再附一顆音效開關（Icons/Audio2=開 / Audio0=靜音），
//                      狀態存於 `<key>Sound`，soundDefault 為其預設。
//   pageBreakBefore: true → 此項強制換到新的一頁（設定頁分頁用）
//
// 絕大多數設定不需要 sideEffects：功能都是在使用時直接讀 getFeature()，改了立刻生效，
// 故它們只掛 logChange() 記一筆。只有「切換當下就得動手」的才寫真的副作用
// （例如 animationEngine 要關掉 BC 原生的慾望表情）。
//
// 寫 sideEffects 時務必留意 init 參數：postFeatureSettings() 每次載入都會用當下的值
// 跑一遍所有 sideEffects 並存檔。在 init 時改動其他設定 = 每次登入都覆寫使用者的選擇。
// ════════════════════════════════════════════════════════════════════════════

// 8 大分類（順序即設定頁清單順序）
export const CATEGORIES = [
    'chat', 'theme', 'ui', 'immersion', 'wardrobe', 'performance', 'cheats', 'misc',
];

// 主題所有顏色鍵（供紀錄快照 / 恢復預設 / 染色引擎使用）
export const THEME_COLOR_KEYS = [
    'themeMainColor', 'themeAccentColor', 'themeTextColor',
    'themeAccentHover', 'themeAccentDisabled',
    'themeElement', 'themeElementHover', 'themeElementDisabled', 'themeElementHint',
    'themeTextDisabled', 'themeTextShadow',
    'themeInvalid', 'themeEquipped', 'themeCrafted', 'themeBlocked', 'themeLimited',
    'themeAllowed', 'themeRoomFriend', 'themeRoomBlocked', 'themeRoomGame',
];

// 無副作用的設定用這個：載入時不吵，變更時記一筆。
// （功能自己在使用時讀 getFeature()，不需要在這裡做任何事 —— 這不是待辦。）
const logChange = (key) => (newValue, init) => {
    if (!init) console.debug('🐈‍⬛ [LCE] setting changed:', key, '=', newValue);
};

/**
 * 這些分類的設定「不分帳號、全域共用」，存 localStorage 而非 Player.ExtensionSettings。
 * 原因有二：
 *   1. 使用者要求外觀類設定跨帳號共用（換帳號不用重設主題）。
 *   2. 登入頁在 LoginLoad 就要套用（此時還沒有 Player），DB 根本讀不到。
 * 其餘分類一律留在 DB（每帳號 + 伺服器同步）。
 */
export const GLOBAL_CATEGORIES = ['ui', 'theme'];

/**
 * 全域共用的設定鍵集合（含 withToggle / withSound 動態產生的鍵）。
 * 分類屬於 GLOBAL_CATEGORIES，或個別標了 `global: true` 的都算。
 */
export function globalKeys() {
    const out = new Set();
    for (const [key, def] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
        if (!GLOBAL_CATEGORIES.includes(def.category) && !def.global) continue;
        if (def.type === 'action') continue;
        out.add(key);
        if (def.withToggle) out.add(`${key}Enabled`);
        if (def.withSound) out.add(`${key}Sound`);
    }
    return out;
}

/** 該鍵是否為全域共用設定。 */
export const isGlobalKey = (key) => globalKeys().has(key);

// 共用 select 選項
const GARBLE_LEVEL     = ['none', 'low', 'medium', 'high', 'full'];
const GARBLE_LEVEL_LBL = ['so_g_none', 'so_g_low', 'so_g_medium', 'so_g_high', 'so_g_full'];
const WHISPER_LEVEL     = ['none', 'low', 'medium', 'high', 'full', 'off'];
const WHISPER_LEVEL_LBL = ['so_g_none', 'so_g_low', 'so_g_medium', 'so_g_high', 'so_g_full', 'so_g_off'];
const TALK_MODE     = ['remove', 'ignore', 'preserve'];
const TALK_MODE_LBL = ['so_t_remove', 'so_t_ignore', 'so_t_preserve'];
const NOTIFY_STYLE     = ['bubble', 'message', 'both'];         // 已有啟用勾選箱，故不需「關閉」
const NOTIFY_STYLE_LBL = ['so_n_bubble', 'so_n_message', 'so_n_both'];

// 貼圖畫質：值即縮放比例的代號，實際比例見 features/performance.js 的 TEXTURE_SCALE
const TEX_QUALITY     = ['normal', 'low', 'lowest'];
const TEX_QUALITY_LBL = ['so_tq_normal', 'so_tq_low', 'so_tq_lowest'];

// FPS 顯示位置。刻意沒有「正中央」—— 那裡是角色與對話框，擋著沒人想要。
const FPS_POS     = ['tl', 'ml', 'bl', 'tc', 'bc', 'tr', 'mr', 'br'];
const FPS_POS_LBL = ['so_fp_tl', 'so_fp_ml', 'so_fp_bl', 'so_fp_tc', 'so_fp_bc', 'so_fp_tr', 'so_fp_mr', 'so_fp_br'];

/**
 * 把 bar 的值正規化：轉數字 → 對齊 step → 夾在 [min, max]。
 * 存檔可能留著舊版 select 的字串（例如 '50'），或使用者手動改壞的值，
 * 一律經過這裡才會拿去用或畫出來。
 */
export function clampBar(def, raw) {
    const min = def.min ?? 0, max = def.max ?? 100, step = def.step || 1;
    let v = Number(raw);
    if (!Number.isFinite(v)) v = Number(def.value);
    v = min + Math.round((v - min) / step) * step;
    return Math.max(min, Math.min(max, v));
}

// 主題色停用條件
const themeOff  = (s) => !s.themeEnabled;                         // 未開主題 → 全部停用
const themeAdv  = (s) => !s.themeEnabled || s.themeMode !== 'advanced'; // 進階色僅進階模式可改

/**
 * 完整設定表。key 即儲存鍵。
 */
export const DEFAULT_FEATURE_SETTINGS = {
    // ───────────────────────── chat 聊天與社交 ─────────────────────────
    instantMessenger: {
        label: 's_instantMessenger', desc: 'sd_instantMessenger',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('instantMessenger'),
    },
    augmentChat: {
        label: 's_augmentChat', desc: 'sd_augmentChat',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('augmentChat'),
    },
    richOnlineProfile: {
        label: 's_richOnlineProfile', desc: 'sd_richOnlineProfile',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('richOnlineProfile'),
    },
    profileEditProtect: {
        label: 's_profileEditProtect', desc: 'sd_profileEditProtect',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('profileEditProtect'),
    },
    profileTimezoneOverhead: {
        label: 's_profileTimezoneOverhead', desc: 'sd_profileTimezoneOverhead',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('profileTimezoneOverhead'),
    },
    atMentionSelfName: {
        label: 's_atMentionSelfName', desc: 'sd_atMentionSelfName',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('atMentionSelfName'),
    },
    changeOthersPose: {
        label: 's_changeOthersPose', desc: 'sd_changeOthersPose',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('changeOthersPose'),
    },
    chatInputHistory: {
        label: 's_chatInputHistory', desc: 'sd_chatInputHistory',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('chatInputHistory'),
    },
    commandButtons: {
        label: 's_commandButtons', desc: 'sd_commandButtons',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('commandButtons'),
    },
    whisperItalic: {
        label: 's_whisperItalic', desc: 'sd_whisperItalic',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('whisperItalic'),
    },
    chatColors: {
        label: 's_chatColors', desc: 'sd_chatColors',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('chatColors'),
    },
    // 左側勾選箱=啟用通知，右側=樣式（氣泡/信息）。啟用時右側才可切換。
    friendOnlineNotify: {
        label: 's_friendOnlineNotify', desc: 'sd_friendOnlineNotify',
        type: 'select', value: 'bubble', options: NOTIFY_STYLE, optionLabels: NOTIFY_STYLE_LBL, category: 'chat',
        withToggle: true, toggleDefault: false, withSound: true, soundDefault: true,
        disabled: () => false, sideEffects: logChange('friendOnlineNotify'),
    },
    friendOfflineNotify: {
        label: 's_friendOfflineNotify', desc: 'sd_friendOfflineNotify',
        type: 'select', value: 'bubble', options: NOTIFY_STYLE, optionLabels: NOTIFY_STYLE_LBL, category: 'chat',
        withToggle: true, toggleDefault: false, withSound: true, soundDefault: true,
        disabled: () => false, sideEffects: logChange('friendOfflineNotify'),
    },
    pastProfiles: {
        label: 's_pastProfiles', desc: 'sd_pastProfiles',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('pastProfiles'),
    },
    pendingMessages: {
        label: 's_pendingMessages', desc: 'sd_pendingMessages',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: logChange('pendingMessages'),
    },
    // 安全詞回復時不自動收緊互動權限（見 features/safeword.js）。預設關閉。
    safewordKeepPermission: {
        label: 's_safewordKeepPermission', desc: 'sd_safewordKeepPermission',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: logChange('safewordKeepPermission'),
    },

    // ───────────────────────── theme 主題 ─────────────────────────
    themeEnabled: {
        label: 's_themeEnabled', desc: 'sd_themeEnabled',
        type: 'checkbox', value: false, category: 'theme', disabled: () => false, sideEffects: logChange('themeEnabled'),
    },
    themeMode: {
        // simple = 只填主/強調/文字色，其餘自動衍生；advanced = 逐項填入所有顏色
        label: 's_themeMode', desc: 'sd_themeMode',
        type: 'select', value: 'simple', options: ['simple', 'advanced'], optionLabels: ['so_tm_simple', 'so_tm_advanced'],
        category: 'theme', disabled: themeOff, sideEffects: logChange('themeMode'),
    },
    themeFlatColor: {
        // 開：背景直接填滿主色；關：保留原背景圖並以主色 multiply 疊色（同 Themed）
        label: 's_themeFlatColor', desc: 'sd_themeFlatColor',
        type: 'checkbox', value: false, category: 'theme', disabled: themeOff, sideEffects: logChange('themeFlatColor'),
    },
    // 介面字型：左側勾選啟用，右側填字型名稱（見 features/theme-font.js）。
    // 刻意獨立於 themeEnabled（disabled 恆 false）—— 換字型不必連染色一起開。
    // 缺字時瀏覽器沿 font stack 逐字後退到萬用字型，不需要特別的「雙字元」處理。
    themeFont: {
        // subtype 'font'：點右側欄位會開出「系統已安裝字型」的下拉清單（見 settings-page 的 openFontPicker）。
        label: 's_themeFont', desc: 'sd_themeFont',
        type: 'input', subtype: 'font', value: '', category: 'theme',
        withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('themeFont'),
    },
    themeMainColor:     { label: 's_c_main',     desc: 'sd_c_main',     type: 'input', subtype: 'color', value: '#202020', category: 'theme', disabled: themeOff, sideEffects: logChange('themeMainColor') },
    themeAccentColor:   { label: 's_c_accent',   desc: 'sd_c_accent',   type: 'input', subtype: 'color', value: '#440171', category: 'theme', disabled: themeOff, sideEffects: logChange('themeAccentColor') },
    themeTextColor:     { label: 's_c_text',     desc: 'sd_c_text',     type: 'input', subtype: 'color', value: '#cccccc', category: 'theme', disabled: themeOff, sideEffects: logChange('themeTextColor') },
    // 進階：強調色狀態
    themeAccentHover:   { label: 's_c_accentHover',   desc: 'sd_c_state', type: 'input', subtype: 'color', value: '#5a0194', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeAccentHover') },
    themeAccentDisabled:{ label: 's_c_accentDisabled',desc: 'sd_c_state', type: 'input', subtype: 'color', value: '#2e014d', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeAccentDisabled') },
    // 進階：元件（按鈕）狀態
    themeElement:       { label: 's_c_element',       desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#2e2e2e', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeElement') },
    themeElementHover:  { label: 's_c_elementHover',  desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#4a4a4a', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeElementHover') },
    themeElementDisabled:{label: 's_c_elementDisabled',desc:'sd_c_button',type: 'input', subtype: 'color', value: '#1a1a1a', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeElementDisabled') },
    themeElementHint:   { label: 's_c_elementHint',   desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#4a4a4a', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeElementHint') },
    // 進階：文字狀態
    themeTextDisabled:  { label: 's_c_textDisabled',  desc: 'sd_c_text2', type: 'input', subtype: 'color', value: '#a3a3a3', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeTextDisabled') },
    themeTextShadow:    { label: 's_c_textShadow',    desc: 'sd_c_text2', type: 'input', subtype: 'color', value: '#a3a3a3', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeTextShadow') },
    // 進階：狀態色（房間/物品）
    themeInvalid:    { label: 's_c_invalid',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeInvalid') },
    themeEquipped:   { label: 's_c_equipped',   desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#3575b5', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeEquipped') },
    themeCrafted:    { label: 's_c_crafted',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#aaa235', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeCrafted') },
    themeBlocked:    { label: 's_c_blocked',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeBlocked') },
    themeLimited:    { label: 's_c_limited',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#9d6600', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeLimited') },
    themeAllowed:    { label: 's_c_allowed',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#008800', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeAllowed') },
    themeRoomFriend: { label: 's_c_roomFriend', desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#008800', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeRoomFriend') },
    themeRoomBlocked:{ label: 's_c_roomBlocked',desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeRoomBlocked') },
    themeRoomGame:   { label: 's_c_roomGame',   desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#3575b5', category: 'theme', disabled: themeAdv, sideEffects: logChange('themeRoomGame') },
    // 紀錄（3 組）+ 恢復預設。run(s) 收到目前設定物件進行快照/還原。
    themeSlot: {
        label: 's_themeSlot', desc: 'sd_themeSlot',
        type: 'select', value: '1', options: ['1', '2', '3'], category: 'theme',
        disabled: themeOff, sideEffects: logChange('themeSlot'),
    },
    saveThemeSlot: {
        label: 's_saveThemeSlot', desc: 'sd_saveThemeSlot', type: 'action', category: 'theme',
        actionLabel: 's_saveThemeSlot_btn', actionDoneLabel: 's_saveThemeSlot_done', disabled: themeOff,
        run: (s) => {
            if (!s) return;
            s.themeSlots = Array.isArray(s.themeSlots) ? s.themeSlots.slice() : [null, null, null];
            const i = Math.max(0, Math.min(2, parseInt(s.themeSlot || '1', 10) - 1));
            s.themeSlots[i] = Object.fromEntries(THEME_COLOR_KEYS.map(k => [k, s[k]]));
        },
    },
    loadThemeSlot: {
        label: 's_loadThemeSlot', desc: 'sd_loadThemeSlot', type: 'action', category: 'theme',
        actionLabel: 's_loadThemeSlot_btn', actionDoneLabel: 's_loadThemeSlot_done', disabled: themeOff,
        run: (s) => {
            if (!s) return;
            const i = Math.max(0, Math.min(2, parseInt(s.themeSlot || '1', 10) - 1));
            const snap = Array.isArray(s.themeSlots) ? s.themeSlots[i] : null;
            if (snap && typeof snap === 'object') for (const k of THEME_COLOR_KEYS) if (k in snap) s[k] = snap[k];
        },
    },
    resetTheme: {
        label: 's_resetTheme', desc: 'sd_resetTheme', type: 'action', category: 'theme',
        actionLabel: 's_resetTheme_btn', actionDoneLabel: 's_resetTheme_done', disabled: themeOff,
        run: (s) => {
            if (!s) return;
            for (const k of THEME_COLOR_KEYS) s[k] = DEFAULT_FEATURE_SETTINGS[k].value;
        },
    },

    // ───────────────────────── ui UI 替換 ─────────────────────────
    // 註：「美化登入介面」不放在這裡 —— 功能設定要等 Player.AccountName（登入後）才載入，
    // 而登入頁是在 LoginLoad（登入前）就套用，讀不到這裡的值。該開關由登入頁自己的
    // 設定浮層管理（存全域 lce_settings 的 enhance，見 loginpage/settings-ui.js）。
    // 橫式 / 直式登入是一對：依螢幕方向各自決定要不要用 LCE 的登入頁，
    // 關掉的那個方向會退回 BC 原生登入頁。兩者都是全域設定（ui 分類），
    // 所以登入頁的設定浮層與遊戲內設定頁改的是同一份值。
    horizontalLogin: {
        label: 's_horizontalLogin', desc: 'sd_horizontalLogin',
        type: 'checkbox', value: true, category: 'ui', disabled: () => false, sideEffects: logChange('horizontalLogin'),
    },
    verticalLogin: {
        label: 's_verticalLogin', desc: 'sd_verticalLogin',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: logChange('verticalLogin'),
    },
    verticalChatSearch: {
        label: 's_verticalChatSearch', desc: 'sd_verticalChatSearch',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: logChange('verticalChatSearch'),
    },
    verticalChatRoom: {
        label: 's_verticalChatRoom', desc: 'sd_verticalChatRoom',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: logChange('verticalChatRoom'),
    },
    // LCE 自己的介面配色。與 theme 分類（BC 主題）無關 —— 那邊染的是 BC 本體，
    // 這幾個染的是 LCE 自己畫出來的東西，所以主題關著也有效。
    // 套用在 features/ui-colors.js，改完即時生效。
    loginAccentColor: {
        label: 's_loginAccentColor', desc: 'sd_loginAccentColor',
        type: 'input', subtype: 'color', value: '#7214ff', category: 'ui',
        pageBreakBefore: true,   // 4 項 UI 替換一頁，5 項染色另起一頁
        disabled: () => false, sideEffects: logChange('loginAccentColor'),
    },
    sysMsgBgColor: {
        label: 's_sysMsgBgColor', desc: 'sd_sysMsgBgColor',
        type: 'input', subtype: 'color', value: '#ba9eff', category: 'ui',
        disabled: () => false, sideEffects: logChange('sysMsgBgColor'),
    },
    sysMsgTextColor: {
        label: 's_sysMsgTextColor', desc: 'sd_sysMsgTextColor',
        type: 'input', subtype: 'color', value: '#000000', category: 'ui',
        disabled: () => false, sideEffects: logChange('sysMsgTextColor'),
    },
    commanderBtnColor: {
        label: 's_commanderBtnColor', desc: 'sd_commanderBtnColor',
        type: 'input', subtype: 'color', value: '#4b0082', category: 'ui',
        disabled: () => false, sideEffects: logChange('commanderBtnColor'),
    },
    notifyBubbleColor: {
        label: 's_notifyBubbleColor', desc: 'sd_notifyBubbleColor',
        type: 'input', subtype: 'color', value: '#ba9eff', category: 'ui',
        disabled: () => false, sideEffects: logChange('notifyBubbleColor'),
    },
    notifyBubbleTextColor: {
        label: 's_notifyBubbleTextColor', desc: 'sd_notifyBubbleTextColor',
        type: 'input', subtype: 'color', value: '#1a0033', category: 'ui',
        disabled: () => false, sideEffects: logChange('notifyBubbleTextColor'),
    },
    // 設定頁下方的說明框（drawTooltip）。這兩個是 canvas 繪製，不吃 CSS 變數，
    // 由 settings-page.js 自己讀。
    //
    // 預設值刻意保持 BC/WCE 原本的黃底黑字，而且必須是「這兩個值」——
    // BC 主題的染色引擎是靠比對顏色來換色的（#ffff88 → element、#000000 → text，
    // 見 features/theme.js 的 KNOWN 對照表）。維持原值，開主題時說明框才會跟著染色；
    // 一旦改成別的顏色，就等於明講「我要這個顏色」，主題不會再插手。
    tooltipBgColor: {
        label: 's_tooltipBgColor', desc: 'sd_tooltipBgColor',
        type: 'input', subtype: 'color', value: '#ffff88', category: 'ui',
        disabled: () => false, sideEffects: logChange('tooltipBgColor'),
    },
    tooltipTextColor: {
        label: 's_tooltipTextColor', desc: 'sd_tooltipTextColor',
        type: 'input', subtype: 'color', value: '#000000', category: 'ui',
        disabled: () => false, sideEffects: logChange('tooltipTextColor'),
    },

    // ───────────────────────── immersion 沉浸體驗 ─────────────────────────
    // 表情引擎總開關。開啟後 LCE 會接管 BC 的表情與姿勢系統：CharacterSetFacialExpression
    // 被改導進 250ms 佇列引擎，BC 原本的函式本體不再執行。因此預設關閉、需明示同意，
    // 下面兩項表情功能也必須靠它才能開（同 WCE 的 animationEngine）。
    animationEngine: {
        label: 's_animationEngine', desc: 'sd_animationEngine',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false,
        sideEffects: (newValue, init, s) => {
            // 接管後 BC 原生的慾望表情會與引擎互搶同一張臉
            if (newValue && Player?.ArousalSettings) Player.ArousalSettings.AffectExpression = false;
            // 使用者「手動」關掉總開關時，一併關掉附屬功能。
            // 絕不可在 init 時做：postFeatureSettings 每次載入都會用當下值跑一次
            // sideEffects 並存檔，而本開關是後加的、預設 false —— 舊存檔的
            // activityExpressions=true 會在每次登入被靜靜清成 false，表情引擎形同永久停用。
            // （附屬功能留著 true 也無害：disabled 會擋 UI，engineOn 會擋執行。）
            if (!init && !newValue) {
                s.autoArousalExpression = false;
                s.activityExpressions = false;
            }
            if (!init) console.debug('🐈‍⬛ [LCE] setting changed: animationEngine =', newValue);
        },
    },
    autoArousalExpression: {
        label: 's_autoArousalExpression', desc: 'sd_autoArousalExpression',
        type: 'checkbox', value: false, category: 'immersion',
        disabled: (s) => !s.animationEngine, sideEffects: logChange('autoArousalExpression'),
    },
    autoMouthOnTalk: {
        label: 's_autoMouthOnTalk', desc: 'sd_autoMouthOnTalk',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: logChange('autoMouthOnTalk'),
    },
    urlAsOoc: {
        label: 's_urlAsOoc', desc: 'sd_urlAsOoc',
        type: 'checkbox', value: true, category: 'immersion', disabled: () => false, sideEffects: logChange('urlAsOoc'),
    },
    activityExpressions: {
        label: 's_activityExpressions', desc: 'sd_activityExpressions',
        type: 'checkbox', value: false, category: 'immersion',
        disabled: (s) => !s.animationEngine, sideEffects: logChange('activityExpressions'),
    },
    arousalGrowthAmount: {
        // 左側開關（arousalGrowthAmountEnabled），關閉時右側無法填值。0~100，100 = 原本 10 倍。
        label: 's_arousalGrowthAmount', desc: 'sd_arousalGrowthAmount',
        type: 'input', value: '0', category: 'immersion',
        withToggle: true, toggleDefault: false, disabled: () => false, sideEffects: logChange('arousalGrowthAmount'),
    },
    stutters: {
        label: 's_stutters', desc: 'sd_stutters',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: logChange('stutters'),
    },
    antiDeaf: {
        label: 's_antiDeaf', desc: 'sd_antiDeaf',
        type: 'checkbox', value: false, category: 'immersion',
        pageBreakBefore: true,   // 防聾/防混淆與 6 項混淆細節同頁，概念相近較直觀
        disabled: () => false, sideEffects: logChange('antiDeaf'),
    },
    antiGarble: {
        label: 's_antiGarble', desc: 'sd_antiGarble',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: logChange('antiGarble'),
    },
    antiGarbleChatLevel: {
        label: 's_antiGarbleChatLevel', desc: 'sd_antiGarbleChatLevel',
        type: 'select', value: 'full', options: GARBLE_LEVEL, optionLabels: GARBLE_LEVEL_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble, sideEffects: logChange('antiGarbleChatLevel'),
    },
    antiGarbleChatStutter: {
        label: 's_antiGarbleChatStutter', desc: 'sd_antiGarbleChatStutter',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || s.antiGarbleChatLevel === 'full', sideEffects: logChange('antiGarbleChatStutter'),
    },
    antiGarbleChatBabyTalk: {
        label: 's_antiGarbleChatBabyTalk', desc: 'sd_antiGarbleChatBabyTalk',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || s.antiGarbleChatLevel === 'full', sideEffects: logChange('antiGarbleChatBabyTalk'),
    },
    antiGarbleWhisperLevel: {
        label: 's_antiGarbleWhisperLevel', desc: 'sd_antiGarbleWhisperLevel',
        type: 'select', value: 'full', options: WHISPER_LEVEL, optionLabels: WHISPER_LEVEL_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble, sideEffects: logChange('antiGarbleWhisperLevel'),
    },
    antiGarbleWhisperStutter: {
        label: 's_antiGarbleWhisperStutter', desc: 'sd_antiGarbleWhisperStutter',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || ['off', 'full'].includes(s.antiGarbleWhisperLevel), sideEffects: logChange('antiGarbleWhisperStutter'),
    },
    antiGarbleWhisperBabyTalk: {
        label: 's_antiGarbleWhisperBabyTalk', desc: 'sd_antiGarbleWhisperBabyTalk',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || ['off', 'full'].includes(s.antiGarbleWhisperLevel), sideEffects: logChange('antiGarbleWhisperBabyTalk'),
    },

    // ───────────────────────── wardrobe 衣櫃 ─────────────────────────
    privateWardrobe: {
        label: 's_privateWardrobe', desc: 'sd_privateWardrobe',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: logChange('privateWardrobe'),
    },
    confirmWardrobeSave: {
        label: 's_confirmWardrobeSave', desc: 'sd_confirmWardrobeSave',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: logChange('confirmWardrobeSave'),
    },
    extendedWardrobe: {
        label: 's_extendedWardrobe', desc: 'sd_extendedWardrobe',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: logChange('extendedWardrobe'),
    },
    layeringHide: {
        label: 's_layeringHide', desc: 'sd_layeringHide',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: logChange('layeringHide'),
    },
    grantWardrobe: {
        // 動作按鈕（座標同其他項）：直接取得私人房間衣櫃，點下顯示回饋。
        label: 's_grantWardrobe', desc: 'sd_grantWardrobe',
        type: 'action', category: 'wardrobe', disabled: () => false,
        actionLabel: 's_grantWardrobe_btn', actionDoneLabel: 's_grantWardrobe_done',
        run: () => {
            try {
                if (typeof LogQuery === 'function' && LogQuery('Wardrobe', 'PrivateRoom')) return;
                if (typeof LogAdd === 'function') LogAdd('Wardrobe', 'PrivateRoom');
            } catch (e) { console.warn('🐈‍⬛ [LCE] grantWardrobe 失敗:', e); }
        },
    },

    // ───────────────────────── performance 性能 ─────────────────────────
    automateCacheClear: {
        label: 's_automateCacheClear', desc: 'sd_automateCacheClear',
        type: 'checkbox', value: true, category: 'performance', disabled: () => false, sideEffects: logChange('automateCacheClear'),
    },
    manualCacheClear: {
        label: 's_manualCacheClear', desc: 'sd_manualCacheClear',
        type: 'checkbox', value: false, category: 'performance', disabled: () => false, sideEffects: logChange('manualCacheClear'),
    },
    // 以下為性能細項（預設：全關）。每項都是「左側勾選箱＝開關、右側＝參數」的複合控制項。
    //
    // 訊息節約分成兩段，對應兩種成本（移植自 Liko - CCM）：
    //   scrollMaxMessages  可見數。超出的舊訊息掛 content-visibility:auto，讓瀏覽器跳過
    //                      排版與繪製 —— 訊息仍在 DOM 裡，其他插件照樣抓得到。
    //   autoPruneMessages  自動清除。訊息數真的多到吃記憶體時才物理移除最舊的，
    //                      一律停在目前房間分隔線之前，且清完固定留 PRUNE_KEEP 條。
    // 往回捲看歷史時兩者都會暫停，不會把正在看的內容藏起來或刪掉。
    scrollMaxMessages: {
        label: 's_scrollMaxMessages', desc: 'sd_scrollMaxMessages',
        type: 'bar', value: 50, min: 25, max: 100, step: 5, category: 'performance',
        withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('scrollMaxMessages'),
    },
    autoPruneMessages: {
        label: 's_autoPruneMessages', desc: 'sd_autoPruneMessages',
        type: 'bar', value: 1000, min: 500, max: 5000, step: 100, category: 'performance',
        withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('autoPruneMessages'),
    },
    // 舊版的 reduceTextureQuality 是布林、且實際上只設了 LINEAR 過濾（BC 本來就設了，等於沒作用）。
    // 改名換型別，讓載入時的未知鍵清理順手把舊值丟掉，不必寫遷移。
    textureQuality: {
        label: 's_textureQuality', desc: 'sd_textureQuality',
        type: 'select', value: 'normal', options: TEX_QUALITY, optionLabels: TEX_QUALITY_LBL,
        category: 'performance', withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('textureQuality'),
    },
    // 同上：舊版 lowFrameRate 是布林（固定 30fps），改名成可調上限。
    lowFrameRateFps: {
        label: 's_lowFrameRateFps', desc: 'sd_lowFrameRateFps',
        type: 'bar', value: 30, min: 10, max: 45, step: 5, category: 'performance',
        withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('lowFrameRateFps'),
    },
    showFps: {
        label: 's_showFps', desc: 'sd_showFps',
        type: 'select', value: 'tl', options: FPS_POS, optionLabels: FPS_POS_LBL,
        category: 'performance', withToggle: true, toggleDefault: false,
        disabled: () => false, sideEffects: logChange('showFps'),
    },

    // ───────────────────────── cheats 作弊與反作弊 ─────────────────────────
    antiCheatLevel: {
        // 左側開關（antiCheatLevelEnabled），關閉 = 不啟用；已移除「停用」選項。
        label: 's_antiCheatLevel', desc: 'sd_antiCheatLevel',
        type: 'select', value: 'whitelist',
        options:      ['blacklist', 'friend', 'whitelist', 'lover', 'owner', 'self'],
        optionLabels: ['so_ac_blacklist', 'so_ac_friend', 'so_ac_whitelist', 'so_ac_lover', 'so_ac_owner', 'so_ac_self'],
        category: 'cheats', withToggle: true, toggleDefault: false, disabled: () => false, sideEffects: logChange('antiCheatLevel'),
    },
    antiCheatBlacklist: {
        label: 's_antiCheatBlacklist', desc: 'sd_antiCheatBlacklist',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('antiCheatBlacklist'),
    },
    uwall: {
        label: 's_uwall', desc: 'sd_uwall',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('uwall'),
    },
    lockpick: {
        label: 's_lockpick', desc: 'sd_lockpick',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('lockpick'),
    },
    allowLayeringWhileBound: {
        label: 's_allowLayeringWhileBound', desc: 'sd_allowLayeringWhileBound',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('allowLayeringWhileBound'),
    },
    autoStruggle: {
        label: 's_autoStruggle', desc: 'sd_autoStruggle',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('autoStruggle'),
    },
    allowIMBypassBCX: {
        label: 's_allowIMBypassBCX', desc: 'sd_allowIMBypassBCX',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: logChange('allowIMBypassBCX'),
    },

    // ───────────────────────── misc 雜項 ─────────────────────────
    relogin: {
        label: 's_relogin', desc: 'sd_relogin',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: logChange('relogin'),
    },
    confirmLeave: {
        label: 's_confirmLeave', desc: 'sd_confirmLeave',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: logChange('confirmLeave'),
    },
    customContentDomainCheck: {
        label: 's_customContentDomainCheck', desc: 'sd_customContentDomainCheck',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: logChange('customContentDomainCheck'),
    },
    // 只影響「完整插件清單」要不要一起送。LCE 的版本號一律會送 ——
    // 那是 /versions 看得到其他 LCE 使用者的唯一依據（見 features/hello.js）。
    shareAddons: {
        label: 's_shareAddons', desc: 'sd_shareAddons',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: logChange('shareAddons'),
    },
    ghostNewUsers: {
        label: 's_ghostNewUsers', desc: 'sd_ghostNewUsers',
        type: 'checkbox', value: false, category: 'misc', disabled: () => false, sideEffects: logChange('ghostNewUsers'),
    },
    // 註：指令系統（/lce、/w、/beep…）沒有開關 —— 它是必要功能，一律啟用。

    // ───────────────────────── hidden 隱藏（不顯示於設定頁）─────────────────────────
    // 3 組主題紀錄快照；由 saveThemeSlot / loadThemeSlot 存取。
    // global: true —— 分類是 hidden，但內容純粹是主題色。主題已改全域共用，
    // 快照若留在各帳號，會變成「在 A 帳號存的主題到 B 帳號讀不到」。
    themeSlots: { type: 'hidden', value: [null, null, null], category: 'hidden', global: true, disabled: () => false },
};

/**
 * 產生只含預設值的物件（用於初始化 / 補齊缺漏）。
 * action 型別無值；withToggle 會額外產生 `<key>Enabled` 布林。
 */
export function defaultValues() {
    const out = {};
    for (const [key, def] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
        if (def.type === 'action') continue;
        // 陣列/物件預設值淺拷貝，避免多個設定物件共用同一參考
        out[key] = Array.isArray(def.value) ? def.value.slice() : def.value;
        if (def.withToggle) out[`${key}Enabled`] = def.toggleDefault ?? false;
        if (def.withSound) out[`${key}Sound`] = def.soundDefault ?? true;
    }
    return out;
}
