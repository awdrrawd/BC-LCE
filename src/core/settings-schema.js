// ════════════════════════════════════════════════════════════════════════════
// 功能設定 Schema（仿 WCE src/util/settings.ts 的 defaultSettings）
// 每一項描述一個設定：型別、預設值、所屬分類、停用條件、切換副作用。
//
//   label / desc / optionLabels / actionLabel… 都是 i18n key（見 core/i18n.js），
//   由設定頁透過 T() 翻譯後顯示，故此表不含硬編碼顯示字串。
//
//   disabled(s)                → 傳入目前設定物件，回傳 true 表示不可操作
//   sideEffects(newValue, init, s) → 值變更（或載入 init=true）時執行；stub 階段多為 TODO
//   type: 'checkbox' | 'select' | 'input' | 'action'
//     select 的 options 是實際儲存值，optionLabels 是平行的 i18n key（省略則直接顯示值）
//     action 沒有值，顯示成按鈕，點擊呼叫 run()
//   withToggle: true → 該 select/input 左側附一個勾選箱，狀態存於 `<key>Enabled`，
//                      關閉時右側控制項停用（見 settings-page.js）。toggleDefault 為其預設。
//   withSound: true  → 控制項右側再附一顆音效開關（Icons/Audio2=開 / Audio0=靜音），
//                      狀態存於 `<key>Sound`，soundDefault 為其預設。
//   pageBreakBefore: true → 此項強制換到新的一頁（設定頁分頁用）
//
// 本階段（設定骨架）各 sideEffects 僅留 TODO；實際行為於後續階段移植。
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

// stub sideEffects（載入時不吵，變更時記一筆）
const todo = (key) => (newValue, init) => {
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
const NOTIFY_STYLE     = ['bubble', 'message'];                 // 已有啟用勾選箱，故不需「關閉」
const NOTIFY_STYLE_LBL = ['so_n_bubble', 'so_n_message'];
const MAXMSG           = ['25', '30', '35', '40', '45', '50'];  // 直接顯示數字，無需 optionLabels

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
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('instantMessenger'),
    },
    augmentChat: {
        label: 's_augmentChat', desc: 'sd_augmentChat',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('augmentChat'),
    },
    richOnlineProfile: {
        label: 's_richOnlineProfile', desc: 'sd_richOnlineProfile',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('richOnlineProfile'),
    },
    profileEditProtect: {
        label: 's_profileEditProtect', desc: 'sd_profileEditProtect',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('profileEditProtect'),
    },
    profileTimezoneOverhead: {
        label: 's_profileTimezoneOverhead', desc: 'sd_profileTimezoneOverhead',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('profileTimezoneOverhead'),
    },
    atMentionSelfName: {
        label: 's_atMentionSelfName', desc: 'sd_atMentionSelfName',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('atMentionSelfName'),
    },
    changeOthersPose: {
        label: 's_changeOthersPose', desc: 'sd_changeOthersPose',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('changeOthersPose'),
    },
    chatInputHistory: {
        label: 's_chatInputHistory', desc: 'sd_chatInputHistory',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('chatInputHistory'),
    },
    commandButtons: {
        label: 's_commandButtons', desc: 'sd_commandButtons',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('commandButtons'),
    },
    whisperItalic: {
        label: 's_whisperItalic', desc: 'sd_whisperItalic',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('whisperItalic'),
    },
    chatColors: {
        label: 's_chatColors', desc: 'sd_chatColors',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('chatColors'),
    },
    // 左側勾選箱=啟用通知，右側=樣式（氣泡/信息）。啟用時右側才可切換。
    friendOnlineNotify: {
        label: 's_friendOnlineNotify', desc: 'sd_friendOnlineNotify',
        type: 'select', value: 'bubble', options: NOTIFY_STYLE, optionLabels: NOTIFY_STYLE_LBL, category: 'chat',
        withToggle: true, toggleDefault: false, withSound: true, soundDefault: true,
        disabled: () => false, sideEffects: todo('friendOnlineNotify'),
    },
    friendOfflineNotify: {
        label: 's_friendOfflineNotify', desc: 'sd_friendOfflineNotify',
        type: 'select', value: 'bubble', options: NOTIFY_STYLE, optionLabels: NOTIFY_STYLE_LBL, category: 'chat',
        withToggle: true, toggleDefault: false, withSound: true, soundDefault: true,
        disabled: () => false, sideEffects: todo('friendOfflineNotify'),
    },
    pastProfiles: {
        label: 's_pastProfiles', desc: 'sd_pastProfiles',
        type: 'checkbox', value: false, category: 'chat', disabled: () => false, sideEffects: todo('pastProfiles'),
    },
    pendingMessages: {
        label: 's_pendingMessages', desc: 'sd_pendingMessages',
        type: 'checkbox', value: true, category: 'chat', disabled: () => false, sideEffects: todo('pendingMessages'),
    },

    // ───────────────────────── theme 主題 ─────────────────────────
    themeEnabled: {
        label: 's_themeEnabled', desc: 'sd_themeEnabled',
        type: 'checkbox', value: false, category: 'theme', disabled: () => false, sideEffects: todo('themeEnabled'),
    },
    themeMode: {
        // simple = 只填主/強調/文字色，其餘自動衍生；advanced = 逐項填入所有顏色
        label: 's_themeMode', desc: 'sd_themeMode',
        type: 'select', value: 'simple', options: ['simple', 'advanced'], optionLabels: ['so_tm_simple', 'so_tm_advanced'],
        category: 'theme', disabled: themeOff, sideEffects: todo('themeMode'),
    },
    themeFlatColor: {
        // 開：背景直接填滿主色；關：保留原背景圖並以主色 multiply 疊色（同 Themed）
        label: 's_themeFlatColor', desc: 'sd_themeFlatColor',
        type: 'checkbox', value: true, category: 'theme', disabled: themeOff, sideEffects: todo('themeFlatColor'),
    },
    themeMainColor:     { label: 's_c_main',     desc: 'sd_c_main',     type: 'input', subtype: 'color', value: '#202020', category: 'theme', disabled: themeOff, sideEffects: todo('themeMainColor') },
    themeAccentColor:   { label: 's_c_accent',   desc: 'sd_c_accent',   type: 'input', subtype: 'color', value: '#440171', category: 'theme', disabled: themeOff, sideEffects: todo('themeAccentColor') },
    themeTextColor:     { label: 's_c_text',     desc: 'sd_c_text',     type: 'input', subtype: 'color', value: '#cccccc', category: 'theme', disabled: themeOff, sideEffects: todo('themeTextColor') },
    // 進階：強調色狀態
    themeAccentHover:   { label: 's_c_accentHover',   desc: 'sd_c_state', type: 'input', subtype: 'color', value: '#5a0194', category: 'theme', disabled: themeAdv, sideEffects: todo('themeAccentHover') },
    themeAccentDisabled:{ label: 's_c_accentDisabled',desc: 'sd_c_state', type: 'input', subtype: 'color', value: '#2e014d', category: 'theme', disabled: themeAdv, sideEffects: todo('themeAccentDisabled') },
    // 進階：元件（按鈕）狀態
    themeElement:       { label: 's_c_element',       desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#2e2e2e', category: 'theme', disabled: themeAdv, sideEffects: todo('themeElement') },
    themeElementHover:  { label: 's_c_elementHover',  desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#4a4a4a', category: 'theme', disabled: themeAdv, sideEffects: todo('themeElementHover') },
    themeElementDisabled:{label: 's_c_elementDisabled',desc:'sd_c_button',type: 'input', subtype: 'color', value: '#1a1a1a', category: 'theme', disabled: themeAdv, sideEffects: todo('themeElementDisabled') },
    themeElementHint:   { label: 's_c_elementHint',   desc: 'sd_c_button',type: 'input', subtype: 'color', value: '#4a4a4a', category: 'theme', disabled: themeAdv, sideEffects: todo('themeElementHint') },
    // 進階：文字狀態
    themeTextDisabled:  { label: 's_c_textDisabled',  desc: 'sd_c_text2', type: 'input', subtype: 'color', value: '#a3a3a3', category: 'theme', disabled: themeAdv, sideEffects: todo('themeTextDisabled') },
    themeTextShadow:    { label: 's_c_textShadow',    desc: 'sd_c_text2', type: 'input', subtype: 'color', value: '#a3a3a3', category: 'theme', disabled: themeAdv, sideEffects: todo('themeTextShadow') },
    // 進階：狀態色（房間/物品）
    themeInvalid:    { label: 's_c_invalid',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: todo('themeInvalid') },
    themeEquipped:   { label: 's_c_equipped',   desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#3575b5', category: 'theme', disabled: themeAdv, sideEffects: todo('themeEquipped') },
    themeCrafted:    { label: 's_c_crafted',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#aaa235', category: 'theme', disabled: themeAdv, sideEffects: todo('themeCrafted') },
    themeBlocked:    { label: 's_c_blocked',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: todo('themeBlocked') },
    themeLimited:    { label: 's_c_limited',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#9d6600', category: 'theme', disabled: themeAdv, sideEffects: todo('themeLimited') },
    themeAllowed:    { label: 's_c_allowed',    desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#008800', category: 'theme', disabled: themeAdv, sideEffects: todo('themeAllowed') },
    themeRoomFriend: { label: 's_c_roomFriend', desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#008800', category: 'theme', disabled: themeAdv, sideEffects: todo('themeRoomFriend') },
    themeRoomBlocked:{ label: 's_c_roomBlocked',desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#870c0c', category: 'theme', disabled: themeAdv, sideEffects: todo('themeRoomBlocked') },
    themeRoomGame:   { label: 's_c_roomGame',   desc: 'sd_c_status', type: 'input', subtype: 'color', value: '#3575b5', category: 'theme', disabled: themeAdv, sideEffects: todo('themeRoomGame') },
    // 紀錄（3 組）+ 恢復預設。run(s) 收到目前設定物件進行快照/還原。
    themeSlot: {
        label: 's_themeSlot', desc: 'sd_themeSlot',
        type: 'select', value: '1', options: ['1', '2', '3'], category: 'theme',
        disabled: themeOff, sideEffects: todo('themeSlot'),
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
    verticalLogin: {
        label: 's_verticalLogin', desc: 'sd_verticalLogin',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: todo('verticalLogin'),
    },
    verticalChatSearch: {
        label: 's_verticalChatSearch', desc: 'sd_verticalChatSearch',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: todo('verticalChatSearch'),
    },
    verticalChatRoom: {
        label: 's_verticalChatRoom', desc: 'sd_verticalChatRoom',
        type: 'checkbox', value: false, category: 'ui', disabled: () => false, sideEffects: todo('verticalChatRoom'),
    },

    // ───────────────────────── immersion 沉浸體驗 ─────────────────────────
    autoArousalExpression: {
        label: 's_autoArousalExpression', desc: 'sd_autoArousalExpression',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: todo('autoArousalExpression'),
    },
    autoMouthOnTalk: {
        label: 's_autoMouthOnTalk', desc: 'sd_autoMouthOnTalk',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: todo('autoMouthOnTalk'),
    },
    activityExpressions: {
        label: 's_activityExpressions', desc: 'sd_activityExpressions',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: todo('activityExpressions'),
    },
    arousalGrowthAmount: {
        // 左側開關（arousalGrowthAmountEnabled），關閉時右側無法填值。0~100，100 = 原本 10 倍。
        label: 's_arousalGrowthAmount', desc: 'sd_arousalGrowthAmount',
        type: 'input', value: '0', category: 'immersion',
        withToggle: true, toggleDefault: false, disabled: () => false, sideEffects: todo('arousalGrowthAmount'),
    },
    stutters: {
        label: 's_stutters', desc: 'sd_stutters',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: todo('stutters'),
    },
    antiDeaf: {
        label: 's_antiDeaf', desc: 'sd_antiDeaf',
        type: 'checkbox', value: false, category: 'immersion',
        pageBreakBefore: true,   // 防聾/防混淆與 6 項混淆細節同頁，概念相近較直觀
        disabled: () => false, sideEffects: todo('antiDeaf'),
    },
    antiGarble: {
        label: 's_antiGarble', desc: 'sd_antiGarble',
        type: 'checkbox', value: false, category: 'immersion', disabled: () => false, sideEffects: todo('antiGarble'),
    },
    antiGarbleChatLevel: {
        label: 's_antiGarbleChatLevel', desc: 'sd_antiGarbleChatLevel',
        type: 'select', value: 'full', options: GARBLE_LEVEL, optionLabels: GARBLE_LEVEL_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble, sideEffects: todo('antiGarbleChatLevel'),
    },
    antiGarbleChatStutter: {
        label: 's_antiGarbleChatStutter', desc: 'sd_antiGarbleChatStutter',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || s.antiGarbleChatLevel === 'full', sideEffects: todo('antiGarbleChatStutter'),
    },
    antiGarbleChatBabyTalk: {
        label: 's_antiGarbleChatBabyTalk', desc: 'sd_antiGarbleChatBabyTalk',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || s.antiGarbleChatLevel === 'full', sideEffects: todo('antiGarbleChatBabyTalk'),
    },
    antiGarbleWhisperLevel: {
        label: 's_antiGarbleWhisperLevel', desc: 'sd_antiGarbleWhisperLevel',
        type: 'select', value: 'full', options: WHISPER_LEVEL, optionLabels: WHISPER_LEVEL_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble, sideEffects: todo('antiGarbleWhisperLevel'),
    },
    antiGarbleWhisperStutter: {
        label: 's_antiGarbleWhisperStutter', desc: 'sd_antiGarbleWhisperStutter',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || ['off', 'full'].includes(s.antiGarbleWhisperLevel), sideEffects: todo('antiGarbleWhisperStutter'),
    },
    antiGarbleWhisperBabyTalk: {
        label: 's_antiGarbleWhisperBabyTalk', desc: 'sd_antiGarbleWhisperBabyTalk',
        type: 'select', value: 'preserve', options: TALK_MODE, optionLabels: TALK_MODE_LBL, category: 'immersion',
        disabled: (s) => !s.antiGarble || ['off', 'full'].includes(s.antiGarbleWhisperLevel), sideEffects: todo('antiGarbleWhisperBabyTalk'),
    },

    // ───────────────────────── wardrobe 衣櫃 ─────────────────────────
    privateWardrobe: {
        label: 's_privateWardrobe', desc: 'sd_privateWardrobe',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: todo('privateWardrobe'),
    },
    confirmWardrobeSave: {
        label: 's_confirmWardrobeSave', desc: 'sd_confirmWardrobeSave',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: todo('confirmWardrobeSave'),
    },
    extendedWardrobe: {
        label: 's_extendedWardrobe', desc: 'sd_extendedWardrobe',
        type: 'checkbox', value: false, category: 'wardrobe', disabled: () => false, sideEffects: todo('extendedWardrobe'),
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
        type: 'checkbox', value: false, category: 'performance', disabled: () => false, sideEffects: todo('automateCacheClear'),
    },
    manualCacheClear: {
        label: 's_manualCacheClear', desc: 'sd_manualCacheClear',
        type: 'checkbox', value: false, category: 'performance', disabled: () => false, sideEffects: todo('manualCacheClear'),
    },
    // 以下為 Lian 性能細項（預設：滾動優化開、降畫質/低幀率關）
    scrollOptimization: {
        label: 's_scrollOptimization', desc: 'sd_scrollOptimization',
        type: 'checkbox', value: true, category: 'performance', disabled: () => false, sideEffects: todo('scrollOptimization'),
    },
    scrollMaxMessages: {
        label: 's_scrollMaxMessages', desc: 'sd_scrollMaxMessages',
        type: 'select', value: '40', options: MAXMSG, category: 'performance',
        disabled: (s) => !s.scrollOptimization, sideEffects: todo('scrollMaxMessages'),
    },
    reduceTextureQuality: {
        label: 's_reduceTextureQuality', desc: 'sd_reduceTextureQuality',
        type: 'checkbox', value: false, category: 'performance', disabled: () => false, sideEffects: todo('reduceTextureQuality'),
    },
    lowFrameRate: {
        label: 's_lowFrameRate', desc: 'sd_lowFrameRate',
        type: 'checkbox', value: false, category: 'performance', disabled: () => false, sideEffects: todo('lowFrameRate'),
    },

    // ───────────────────────── cheats 作弊與反作弊 ─────────────────────────
    antiCheatLevel: {
        // 左側開關（antiCheatLevelEnabled），關閉 = 不啟用；已移除「停用」選項。
        label: 's_antiCheatLevel', desc: 'sd_antiCheatLevel',
        type: 'select', value: 'whitelist',
        options:      ['blacklist', 'friend', 'whitelist', 'lover', 'owner', 'self'],
        optionLabels: ['so_ac_blacklist', 'so_ac_friend', 'so_ac_whitelist', 'so_ac_lover', 'so_ac_owner', 'so_ac_self'],
        category: 'cheats', withToggle: true, toggleDefault: false, disabled: () => false, sideEffects: todo('antiCheatLevel'),
    },
    antiCheatBlacklist: {
        label: 's_antiCheatBlacklist', desc: 'sd_antiCheatBlacklist',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: todo('antiCheatBlacklist'),
    },
    uwall: {
        label: 's_uwall', desc: 'sd_uwall',
        type: 'checkbox', value: true, category: 'cheats', disabled: () => false, sideEffects: todo('uwall'),
    },
    lockpick: {
        label: 's_lockpick', desc: 'sd_lockpick',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: todo('lockpick'),
    },
    allowLayeringWhileBound: {
        label: 's_allowLayeringWhileBound', desc: 'sd_allowLayeringWhileBound',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: todo('allowLayeringWhileBound'),
    },
    autoStruggle: {
        label: 's_autoStruggle', desc: 'sd_autoStruggle',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: todo('autoStruggle'),
    },
    allowIMBypassBCX: {
        label: 's_allowIMBypassBCX', desc: 'sd_allowIMBypassBCX',
        type: 'checkbox', value: false, category: 'cheats', disabled: () => false, sideEffects: todo('allowIMBypassBCX'),
    },

    // ───────────────────────── misc 雜項 ─────────────────────────
    relogin: {
        label: 's_relogin', desc: 'sd_relogin',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: todo('relogin'),
    },
    confirmLeave: {
        label: 's_confirmLeave', desc: 'sd_confirmLeave',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: todo('confirmLeave'),
    },
    customContentDomainCheck: {
        label: 's_customContentDomainCheck', desc: 'sd_customContentDomainCheck',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: todo('customContentDomainCheck'),
    },
    shareAddons: {
        label: 's_shareAddons', desc: 'sd_shareAddons',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: todo('shareAddons'),
    },
    ghostNewUsers: {
        label: 's_ghostNewUsers', desc: 'sd_ghostNewUsers',
        type: 'checkbox', value: false, category: 'misc', disabled: () => false, sideEffects: todo('ghostNewUsers'),
    },
    commander: {
        label: 's_commander', desc: 'sd_commander',
        type: 'checkbox', value: true, category: 'misc', disabled: () => false, sideEffects: todo('commander'),
    },

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
