// ════════════════════════════════════════════════════════════════════════════
// i18n（內嵌字庫，依 BC 語言選擇；日後可改接共用引擎）
// ════════════════════════════════════════════════════════════════════════════

const I18N = {
    'zh-TW': {
        welcome:        '歡迎來到束縛俱樂部',
        enter_hint:     '請輸入帳號與密碼',
        label_account:  '帳號',
        label_password: '密碼',
        ph_account:     '帳號',
        ph_password:    '密碼',
        btn_login:      '登入',
        btn_save_acct:  '保存帳號',
        btn_reset:      '重設密碼',
        btn_register:   '創建人物',
        btn_language:   '語言',
        btn_settings:   '設定',
        privacy_note:   '帳號採用AES-GCM加密，僅存於本地',
        acct_area:      '帳號',
        acct_name:      '名稱',
        acct_id:        'ID',
        no_accounts:    '尚無保存的帳號',
        fill_fields:    '請輸入帳號與密碼',
        settings_title: '設定',
        set_enhance:    '登入介面增強',
        set_show_avatar:  '顯示頭像',
        set_show_account: '顯示帳號',
        set_show_name:    '顯示名稱',
        set_bg:         '背景',
        bg_random:      '隨機',
        bg_select:      '選擇',
        settings_close: '關閉',
    },
    'CN': {
        welcome:        '欢迎来到束缚俱乐部',
        enter_hint:     '请输入账号与密码',
        label_account:  '账号',
        label_password: '密码',
        ph_account:     '账号',
        ph_password:    '密码',
        btn_login:      '登录',
        btn_save_acct:  '保存账号',
        btn_reset:      '重置密码',
        btn_register:   '创建人物',
        btn_language:   '语言',
        btn_settings:   '设置',
        privacy_note:   '账号采用AES-GCM加密，仅存于本地',
        acct_area:      '账号',
        acct_name:      '名称',
        acct_id:        'ID',
        no_accounts:    '尚无保存的账号',
        fill_fields:    '请输入账号与密码',
        settings_title: '设置',
        set_enhance:    '登录界面增强',
        set_show_avatar:  '显示头像',
        set_show_account: '显示账号',
        set_show_name:    '显示名称',
        set_bg:         '背景',
        bg_random:      '随机',
        bg_select:      '选择',
        settings_close: '关闭',
    },
    'EN': {
        welcome:        'Welcome to the Bondage Club',
        enter_hint:     'Enter your account and password',
        label_account:  'Account',
        label_password: 'Password',
        ph_account:     'Account',
        ph_password:    'Password',
        btn_login:      'Log in',
        btn_save_acct:  'Save account',
        btn_reset:      'Reset password',
        btn_register:   'Create character',
        btn_language:   'Language',
        btn_settings:   'Settings',
        privacy_note:   'Accounts are AES-GCM encrypted and stored locally only',
        acct_area:      'Account',
        acct_name:      'Name',
        acct_id:        'ID',
        no_accounts:    'No saved accounts',
        fill_fields:    'Enter your account and password',
        settings_title: 'Settings',
        set_enhance:    'Enhanced login UI',
        set_show_avatar:  'Show avatar',
        set_show_account: 'Show account',
        set_show_name:    'Show name',
        set_bg:         'Background',
        bg_random:      'Random',
        bg_select:      'Select',
        settings_close: 'Close',
    },
};

/** 取得目前 BC 語言碼並映射到字庫（TW→zh-TW，CN→CN，其餘→EN） */
function getLang() {
    const code = (typeof TranslationLanguage !== 'undefined' && TranslationLanguage)
        || localStorage.getItem('BondageClubLanguage') || 'EN';
    if (code === 'TW') return 'zh-TW';
    if (code === 'CN') return 'CN';
    return I18N[code] ? code : 'EN';
}

/** 翻譯函式：找不到 key 時回傳 key 本身 */
export function T(key) {
    const table = I18N[getLang()] || I18N.EN;
    return table[key] ?? I18N.EN[key] ?? key;
}

/** 標記元素的 i18n key，供語言切換後即時重刷 */
export function i18nText(el, key) { el.textContent = T(key); el.dataset.lceKey = key; }
export function i18nPlaceholder(el, key) { el.setAttribute('placeholder', T(key)); el.dataset.lcePhKey = key; }

/** 重刷所有帶 i18n 標記的節點 */
export function refreshI18n() {
    document.querySelectorAll('[data-lce-key]').forEach(el => { el.textContent = T(el.dataset.lceKey); });
    document.querySelectorAll('[data-lce-ph-key]').forEach(el => { el.setAttribute('placeholder', T(el.dataset.lcePhKey)); });
}
