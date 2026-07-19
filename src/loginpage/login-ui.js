// ════════════════════════════════════════════════════════════════════════════
// 登入 UI 主流程：建構、事件、狀態同步、定位、啟用/停用、場景偵測
// ════════════════════════════════════════════════════════════════════════════

import {
    CANVAS_W, CANVAS_H, ICON_PERSON, ICON_LOCK, LOGIN_REQUEST_EVENT, WALLPAPER_UPLOAD_SENTINEL,
} from '../core/constants.js';
import { S, saveSettings, loadSettings } from '../core/state.js';
import { T, i18nText, i18nPlaceholder, refreshI18n } from '../core/i18n.js';
import { mk, place, getCanvas, isLandscape, isPortrait } from '../core/util.js';
import { getFeature, setFeature } from '../core/feature-settings.js';
import { previewLoginAccent, clearLoginAccentPreview } from '../features/ui-colors.js';
import { addOrUpdateAccount, saveWallpaper, deleteWallpaper } from '../core/storage.js';
import { hideBC, showBC } from './bc.js';
import { applyBackground, handleBackgroundError } from './background.js';
import { buildCarousel, destroyCarousel, setCarouselAxis } from './account-carousel.js';
import { buildSettingsOverlay, toggleSettings, closeSettings, applyShowSettings } from './settings-ui.js';

// ── 建構 ──────────────────────────────────────────────────────────────────

/** 建立整個登入 UI（只建立一次） */
export function buildUI() {
    if (document.getElementById('lce-stage')) return;

    const stage = mk('div', '', { id: 'lce-stage' });

    // ── 黑底層（在 stage 外面、fixed 滿版）──
    // 背景圖是貼著 canvas 鋪的，而 canvas 置中留邊，畫面上下緣一定會露出一條。
    // 鋪一層純黑在最底下，那條就變成黑邊而不顯眼。
    const bgBase = mk('div', '', { id: 'lce-bg-base' });
    document.body.appendChild(bgBase);

    // ── 滿版背景圖 + 遮罩（stage 內、蓋住 canvas 上的角色/感謝名單/WCE 按鈕） ──
    const bgImg = mk('img', '', { id: 'lce-bg-img', alt: '' });
    // 自訂網址載不出來時退回內建背景，而不是直接把背景藏掉開天窗
    bgImg.onerror = () => handleBackgroundError();
    // 背景影片：疊在圖片上方，僅在有對應 BGV-XX 且載入完成時由 background.js 淡入。
    // muted 兼顧兩件事：使用者不要音樂，且靜音才允許自動播放。
    const bgVideo = mk('video', '', { id: 'lce-bg-video', muted: true, loop: true, playsInline: true, preload: 'auto' });
    bgVideo.setAttribute('playsinline', '');   // iOS/Safari 需要屬性形式才不會全螢幕接管
    const bgOverlay = mk('div', '', { id: 'lce-bg-overlay' });
    stage.appendChild(bgImg);
    stage.appendChild(bgVideo);
    stage.appendChild(bgOverlay);

    // ── 標題 / 歡迎 / 狀態 ──
    const title = mk('div'); title.className = 'lce-text lce-title'; title.textContent = 'Bondage Club';
    place(title, 160, 150, 500, 70, 50); stage.appendChild(title);

    const welcome = mk('div'); welcome.className = 'lce-text lce-welcome'; i18nText(welcome, 'welcome');
    place(welcome, 210, 239, 400, 50, 30); stage.appendChild(welcome);

    const status = mk('div', '', { id: 'lce-status' }); status.className = 'lce-text lce-status'; i18nText(status, 'enter_hint');
    place(status, 210, 303, 400, 50, 30); stage.appendChild(status);

    // ── 表單外框 ──
    const formBox = mk('div'); formBox.className = 'lce-box';
    place(formBox, 160, 375, 500, 430); stage.appendChild(formBox);

    // ── 帳號 / 密碼 輸入（人形 / 鎖 圖示放進輸入框內最前面） ──
    const nameField = mk('div'); nameField.className = 'lce-field';
    const nameInput = mk('input', '', { id: 'lce-input-name', type: 'text', autocomplete: 'off' });
    nameInput.className = 'lce-input'; nameInput.setAttribute('enterkeyhint', 'next'); i18nPlaceholder(nameInput, 'ph_account');
    nameInput.setAttribute('aria-label', T('label_account'));
    const nameIcon  = mk('span', '', { innerHTML: ICON_PERSON }); nameIcon.className = 'lce-field-icon';
    nameField.appendChild(nameInput); nameField.appendChild(nameIcon);
    place(nameField, 210, 400, 400, 50, 22); stage.appendChild(nameField);

    const passField = mk('div'); passField.className = 'lce-field';
    // 密碼欄刻意不用 type="password"：只要瀏覽器認得出這是「帳號＋密碼」組合，
    // 快速登入時就會跳出「要不要記住密碼」。LCE 自己就有 AES-GCM 加密的帳號庫，
    // 再讓瀏覽器存一份既多餘、又每次都擋在畫面上。改用 text + text-security 遮罩：
    // 外觀一樣是圓點，但密碼管理器不會認領它。
    // 瀏覽器不支援 text-security 時退回 type="password" —— 寧可跳提示，也不能讓密碼裸奔。
    const maskable = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc');
    const passInput = mk('input', '', {
        id: 'lce-input-pass',
        type: maskable ? 'text' : 'password',
        autocomplete: 'off',
        spellcheck: false,
    });
    passInput.className = 'lce-input';
    if (maskable) passInput.classList.add('lce-masked');
    passInput.setAttribute('autocapitalize', 'off');
    passInput.setAttribute('autocorrect', 'off');
    passInput.setAttribute('enterkeyhint', 'go'); i18nPlaceholder(passInput, 'ph_password');
    passInput.setAttribute('aria-label', T('label_password'));
    const passIcon  = mk('span', '', { innerHTML: ICON_LOCK }); passIcon.className = 'lce-field-icon';
    passField.appendChild(passInput); passField.appendChild(passIcon);
    place(passField, 210, 465, 400, 50, 22); stage.appendChild(passField);

    // ── 登入按鈕 ──
    const loginBtn = mk('button', '', { id: 'lce-btn-login' }); loginBtn.className = 'lce-btn primary'; i18nText(loginBtn, 'btn_login');
    place(loginBtn, 210, 540, 400, 50, 26); stage.appendChild(loginBtn);

    // ── 保存帳號 / 重設密碼 ──
    // 包一層 row：直式版面靠它把兩顆併排（見 styles.js）。
    // 橫式不受影響 —— 子元素是 position:absolute，會對齊最近的「有定位祖先」（stage），
    // 而這個 row 是 position:static，等於不存在。
    const saveRow = mk('div', '', { id: 'lce-row-save' }); saveRow.className = 'lce-row';
    const saveBtn = mk('button', '', { id: 'lce-btn-save' }); saveBtn.className = 'lce-btn'; i18nText(saveBtn, 'btn_save_acct');
    place(saveBtn, 225, 610, 180, 50, 22); saveRow.appendChild(saveBtn);

    const resetBtn = mk('button', '', { id: 'lce-btn-reset' }); resetBtn.className = 'lce-btn'; i18nText(resetBtn, 'btn_reset');
    place(resetBtn, 420, 610, 180, 50, 22); saveRow.appendChild(resetBtn);
    stage.appendChild(saveRow);

    // ── 創建人物 ──
    const regBtn = mk('button', '', { id: 'lce-btn-register' }); regBtn.className = 'lce-btn'; i18nText(regBtn, 'btn_register');
    place(regBtn, 210, 680, 400, 50, 26); stage.appendChild(regBtn);

    // ── 加密提示 ──
    const note = mk('div'); note.className = 'lce-text lce-note'; i18nText(note, 'privacy_note');
    place(note, 184, 750, 460, 30, 18); stage.appendChild(note);

    // ── 語言 / 設定（同樣包 row，供直式併排） ──
    const bottomRow = mk('div', '', { id: 'lce-row-bottom' }); bottomRow.className = 'lce-row';
    const langSel = mk('select', '', { id: 'lce-lang-select' }); langSel.className = 'lce-select';
    place(langSel, 210, 850, 210, 50, 22); bottomRow.appendChild(langSel);

    const settBtn = mk('button', '', { id: 'lce-btn-settings' }); settBtn.className = 'lce-btn'; i18nText(settBtn, 'btn_settings');
    place(settBtn, 455, 850, 160, 50, 22); bottomRow.appendChild(settBtn);
    stage.appendChild(bottomRow);

    // ── 帳號區（摩天輪；無外框，H 加高、垂直置中於畫面） ──
    const acctArea = mk('div', '', { id: 'lce-acct-area' });
    place(acctArea, 690, 0, 350, 1000); stage.appendChild(acctArea);

    document.body.appendChild(stage);
    S.stageEl = stage;

    buildSettingsOverlay();

    bindEvents();
    buildLanguageSelect();
    buildCarousel();
    syncStatus();
    applyShowSettings();
}

// ── 事件綁定 ──────────────────────────────────────────────────────────────

function bindEvents() {
    document.getElementById('lce-input-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('lce-input-pass').focus();
    });
    document.getElementById('lce-input-pass').addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });
    document.getElementById('lce-btn-login').addEventListener('click', doLogin);
    // 帳號卡連點兩下 → 直接登入（以事件傳遞，避免與 account-carousel 循環相依）
    window.addEventListener(LOGIN_REQUEST_EVENT, doLogin);

    document.getElementById('lce-btn-save').addEventListener('click', async () => {
        const name = document.getElementById('lce-input-name')?.value.trim();
        const pass = document.getElementById('lce-input-pass')?.value;
        if (!name || !pass) return;
        const key = await addOrUpdateAccount(name, pass);
        buildCarousel(key.toUpperCase()); // 重建輪盤並置中剛保存的帳號
    });

    document.getElementById('lce-btn-reset').addEventListener('click', () => {
        if (typeof CommonSetScreen === 'function') CommonSetScreen('Character', 'PasswordReset');
    });

    document.getElementById('lce-btn-register').addEventListener('click', () => {
        if (typeof DisclaimerOpen !== 'function') return;
        DisclaimerOpen(accepted => {
            if (!accepted) { window.location.reload(); return; }
            if (typeof CharacterCreatePlayer === 'function') CharacterCreatePlayer();
            if (typeof InventoryRemove === 'function') {
                InventoryRemove(Player, 'ItemFeet');
                InventoryRemove(Player, 'ItemLegs');
                InventoryRemove(Player, 'ItemArms');
            }
            if (typeof CharacterAppearanceSetDefault === 'function') CharacterAppearanceSetDefault(Player);
            if (typeof CharacterAppearanceLoadCharacter === 'function')
                CharacterAppearanceLoadCharacter(Player, r => CommonSetScreen('Character', r ? 'Creation' : 'Login'));
        });
    });

    document.getElementById('lce-btn-settings').addEventListener('click', toggleSettings);

    // 語言切換：優先透過 BC 原生 dropdown，觸發完整切換流程
    document.getElementById('lce-lang-select').addEventListener('change', function () {
        const code   = this.value;
        const langEl = document.getElementById('LanguageDropdown');
        if (langEl) {
            if (langEl.value !== code) {
                langEl.value = code;
                langEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else if (typeof TranslationSwitchLanguage === 'function') {
            TranslationSwitchLanguage(code || 'EN');
            if (typeof TextLoad === 'function')               TextLoad();
            if (typeof ActivityDictionaryLoad === 'function') ActivityDictionaryLoad();
            if (typeof AssetLoadDescription === 'function')   AssetLoadDescription('Female3DCG');
        }
        setTimeout(() => { S.lastStatusMsg = null; syncStatus(); refreshI18n(); }, 100);
    });

    // 設定：登入介面增強
    // 設定：橫式 / 直式登入介面（全域功能設定，與遊戲內設定頁同一份值）
    for (const [id, key] of [['lce-set-horizontal', 'horizontalLogin'], ['lce-set-vertical', 'verticalLogin']]) {
        document.getElementById(id).addEventListener('change', function () {
            setFeature(key, this.checked);
            // 關掉目前這個方向 → 浮層跟著收起來，否則會浮在 BC 原生登入頁上
            if (!this.checked) closeSettings();
            refreshOrientation();
        });
    }
    // 設定：登入介面色系（全域設定，與遊戲內「UI 設置」同一份值）
    // 拖曳中只預覽不存檔（input 會隨滑鼠連發），放開調色盤才真的寫進設定。
    // 寫入後 setFeature 會發出變更事件，ui-colors 自己會重新套色。
    const accentEl = document.getElementById('lce-set-accent');
    accentEl.addEventListener('input', function () { previewLoginAccent(this.value); });
    accentEl.addEventListener('change', function () {
        clearLoginAccentPreview();
        setFeature('loginAccentColor', this.value);
    });
    // 設定：頭像 / 帳號 / 名稱 顯示
    document.getElementById('lce-set-avatar').addEventListener('change', function () {
        S.settings.showAvatar = this.checked; saveSettings(); applyShowSettings();
    });
    document.getElementById('lce-set-account').addEventListener('change', function () {
        S.settings.showAccount = this.checked; saveSettings(); applyShowSettings();
    });
    document.getElementById('lce-set-name').addEventListener('change', function () {
        S.settings.showName = this.checked; saveSettings(); applyShowSettings();
    });
    // 設定：背景模式
    document.getElementById('lce-set-bgmode').addEventListener('change', function () {
        S.settings.bgMode = this.value; saveSettings();
        document.getElementById('lce-set-bgname-row').style.display = this.value === 'select' ? '' : 'none';
        document.getElementById('lce-set-bgcustom-row').style.display = this.value === 'custom' ? 'flex' : 'none';
        applyBackground();
    });
    // 設定：背景名稱
    document.getElementById('lce-set-bgname').addEventListener('change', function () {
        S.settings.bgName = this.value; saveSettings();
        applyBackground();
    });
    bindCustomWallpaper();
    document.getElementById('lce-sett-close').addEventListener('click', closeSettings);
}

/** 自訂桌布：網址欄、上傳、清除。 */
function bindCustomWallpaper() {
    const urlIn  = document.getElementById('lce-set-bgurl');
    const fileIn = document.getElementById('lce-set-bgfile');
    const hint   = document.getElementById('lce-set-bghint');
    const setHint = (key) => { if (hint) { hint.textContent = key ? T(key) : ''; hint.dataset.lceKey = key || ''; } };

    // 開啟浮層時就先反映目前狀態，使用者才知道現在用的是上傳的那張還是網址
    if (S.settings.bgCustomUrl === WALLPAPER_UPLOAD_SENTINEL) setHint('bg_using_upload');

    // change 而非 input：邊打字邊套用會對著半截網址狂發請求
    urlIn?.addEventListener('change', function () {
        const v = this.value.trim();
        S.settings.bgCustomUrl = v;
        saveSettings();
        setHint(v ? '' : 'bg_empty_fallback');
        applyBackground();
    });

    document.getElementById('lce-set-bgupload')?.addEventListener('click', () => fileIn?.click());

    fileIn?.addEventListener('change', async function () {
        const file = this.files?.[0];
        this.value = '';   // 清掉，否則選同一個檔案第二次不會觸發 change
        if (!file) return;
        try {
            await saveWallpaper(file);
            S.settings.bgCustomUrl = WALLPAPER_UPLOAD_SENTINEL;   // 改用 DB 那張
            saveSettings();
            if (urlIn) urlIn.value = '';
            setHint('bg_using_upload');
            applyBackground();
        } catch (e) {
            // saveWallpaper 會針對「不是圖片」和「檔案太大」丟出可辨識的錯誤
            setHint(e?.message === 'too-large' ? 'bg_too_large' : 'bg_not_image');
            console.warn('🐈‍⬛ [LCE] 桌布上傳失敗:', e);
        }
    });

    document.getElementById('lce-set-bgclear')?.addEventListener('click', async () => {
        await deleteWallpaper();
        S.settings.bgCustomUrl = '';
        saveSettings();
        if (urlIn) urlIn.value = '';
        setHint('bg_empty_fallback');
        applyBackground();
    });
}

/** 建立語言 dropdown，優先取自 BC 原生 dropdown */
function buildLanguageSelect() {
    const sel = document.getElementById('lce-lang-select');
    if (!sel) return;
    sel.innerHTML = '';
    const currentLang = localStorage.getItem('BondageClubLanguage') || 'EN';

    const bcDropdown = document.getElementById('LanguageDropdown');
    if (bcDropdown && bcDropdown.options.length > 0) {
        Array.from(bcDropdown.options).forEach(bcOpt => {
            const opt = mk('option', '', { value: bcOpt.value, textContent: bcOpt.textContent });
            opt.selected = bcOpt.value === currentLang;
            sel.appendChild(opt);
        });
        return;
    }
    if (typeof TranslationDictionary !== 'undefined' && Array.isArray(TranslationDictionary)) {
        TranslationDictionary.forEach(l => {
            const opt = mk('option', '', {
                value: l.LanguageCode,
                textContent: (l.Icon ? l.Icon + ' ' : '') + (l.LanguageName || l.EnglishName || l.LanguageCode),
            });
            opt.selected = l.LanguageCode === currentLang;
            sel.appendChild(opt);
        });
        return;
    }
    const fb = mk('option', '', { value: 'EN', textContent: 'English' }); fb.selected = currentLang === 'EN';
    sel.appendChild(fb);
}

// ── 登入 ──────────────────────────────────────────────────────────────────

export function doLogin() {
    const name = document.getElementById('lce-input-name')?.value || '';
    const pass = document.getElementById('lce-input-pass')?.value || '';

    if (!name || !pass) {
        const el = document.getElementById('lce-status');
        if (el) { el.textContent = T('fill_fields'); el.classList.add('error'); S.lastStatusMsg = el.textContent; S.lastStatusError = true; }
        return;
    }

    // 直接把帳密交給 BC 的登入函式，完全不碰它的 InputName / InputPassword。
    // 這是 WCE 的作法（見 automaticReconnect.js）：只要密碼被寫進 BC 那組 DOM 欄位，
    // 瀏覽器就會判定「使用者剛用這組帳密登入」而跳出記住密碼的提示 —— 而且那次填值
    // 對登入本身毫無作用，LoginDoLogin 收的是參數，不是欄位值。
    if (typeof LoginDoLogin === 'function') { LoginDoLogin(name, pass); return; }

    // 退路：舊版 BC 沒有 LoginDoLogin，只能填欄位再按它的登入鈕。
    // 這條路會跳記住密碼的提示，但總比登不進去好。
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const bcName = document.getElementById('InputName');
    const bcPass = document.getElementById('InputPassword');
    if (bcName && setter) { setter.call(bcName, name); bcName.dispatchEvent(new Event('input', { bubbles: true })); }
    if (bcPass && setter) { setter.call(bcPass, pass); bcPass.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('login-login-button')?.click();
}

// ── 狀態列同步（讀取 BC 登入狀態） ────────────────────────────────────────

export function syncStatus() {
    const el = document.getElementById('lce-status');
    if (!el) return;

    let msg = '', isError = false;
    if (typeof LoginErrorMessage !== 'undefined' && LoginErrorMessage) {
        msg = (typeof TextGet === 'function' ? TextGet(LoginErrorMessage) : '') || LoginErrorMessage;
        isError = true;
    } else if (typeof ServerIsConnected !== 'undefined' && !ServerIsConnected) {
        msg = (typeof TextGet === 'function' ? TextGet('ConnectingToServer') : '') || T('enter_hint');
    } else if (typeof LoginQueuePosition !== 'undefined' && LoginQueuePosition !== -1) {
        const tmpl = (typeof TextGet === 'function' ? TextGet('LoginQueueWait') : '') || 'Queue: QUEUE_POS';
        msg = tmpl.replace('QUEUE_POS', String(LoginQueuePosition));
    } else if (typeof LoginSubmitted !== 'undefined' && LoginSubmitted) {
        msg = (typeof TextGet === 'function' ? TextGet('ValidatingNamePassword') : '') || '...';
    } else {
        msg = (typeof TextGet === 'function' ? TextGet('EnterNamePassword') : '') || T('enter_hint');
    }

    if (msg !== S.lastStatusMsg || isError !== S.lastStatusError) {
        S.lastStatusMsg = msg; S.lastStatusError = isError;
        el.textContent = msg; el.classList.toggle('error', isError);
    }

    const loginBtn = document.getElementById('lce-btn-login');
    if (loginBtn) {
        const canLogin = (typeof ServerIsConnected !== 'undefined' ? ServerIsConnected : true)
            && !(typeof LoginSubmitted !== 'undefined' && LoginSubmitted);
        if (loginBtn.disabled === canLogin) loginBtn.disabled = !canLogin;
    }
}

// ── stage 定位（每幀由 DrawProcess hook 呼叫，數值不變時不重寫避免 reflow） ──
// 使用與 BC ElementSetPosition 相同的 canvas→螢幕換算，確保與角色對齊。

/**
 * 版面配置。兩種模式共用同一份 DOM，只差定位方式：
 *   橫向：stage 貼著 canvas，用 transform 把 2000×1000 的邏輯座標縮放到 canvas 大小。
 *   直向：canvas 在直向會被壓成一條，貼著它整個版面就爛了。改成脫離 canvas 座標系、
 *         滿版 flex 直排（樣式見 styles.js 的 [data-orient="portrait"] 區塊），
 *         這裡只負責清掉 transform 並標記方向。
 */
export function lceLayout() {
    if (!S.stageEl) return;
    const portrait = isPortrait() && !!getFeature('verticalLogin');

    if (portrait) {
        if (S.stageEl.dataset.orient !== 'portrait') {
            S.stageEl.dataset.orient = 'portrait';
            S.stageEl.style.transform = 'none';
            setCarouselAxis('x');
        }
        S.lastLayout = null;   // 之後轉回橫向時要強制重算
        return;
    }

    const cv = getCanvas();
    if (!cv) return;
    if (S.stageEl.dataset.orient !== 'landscape') {
        S.stageEl.dataset.orient = 'landscape';
        S.lastLayout = null;
        setCarouselAxis('y');
    }
    const w = cv.clientWidth, h = cv.clientHeight, l = cv.offsetLeft, t = cv.offsetTop;
    const last = S.lastLayout;
    if (last && last.w === w && last.h === h && last.l === l && last.t === t) return;
    S.lastLayout = { w, h, l, t };
    const sx = w / CANVAS_W, sy = h / CANVAS_H;
    S.stageEl.style.transform = `translate(${l}px, ${t}px) scale(${sx}, ${sy})`;
}

// ── 啟用 / 停用 ────────────────────────────────────────────────────────────

export function lceApply() {
    if (S.active) return;
    S.active = true;
    S.settings = loadSettings(); // 確保讀到最新設定
    buildUI();
    hideBC();
    applyBackground();
    applyShowSettings();
    if (S.stageEl) S.stageEl.style.display = '';
    // 背景層不在 stage 裡，得自己開關 —— 忘了關的話登入後它會一直蓋在遊戲畫面上
    document.getElementById('lce-bg-base')?.toggleAttribute('hidden', false);
    S.lastLayout      = null;
    S.lastStatusMsg   = null;
    S.lastStatusError = null;
    lceLayout();
    S.statusTimer = setInterval(syncStatus, 500);
}

export function lceRemove() {
    if (!S.active) return;
    S.active = false;
    showBC();
    closeSettings();
    if (S.statusTimer) { clearInterval(S.statusTimer); S.statusTimer = null; }
    if (S.stageEl) S.stageEl.style.display = 'none';
    document.getElementById('lce-bg-base')?.toggleAttribute('hidden', true);
}

/**
 * 徹底移除登入 UI（DOM、樣式、監聽），供登入後熱移除使用。
 * 呼叫前應先 lceRemove()。
 */
export function destroyLoginUI() {
    window.removeEventListener(LOGIN_REQUEST_EVENT, doLogin);
    lceRemove();
    destroyCarousel();
    document.getElementById('lce-stage')?.remove();
    document.getElementById('lce-bg-base')?.remove();
    document.getElementById('lce-settings-overlay')?.remove();
    document.getElementById('lce-styles')?.remove();
    document.getElementById('lce-hide-thirdparty')?.remove();
    S.stageEl = null;
}

// ── 場景偵測（每幀由 DrawProcess hook 呼叫） ──────────────────────────────

/**
 * 登入頁是否該啟用：依目前方向查對應的那個開關，關閉則退回 BC 原生登入頁。
 * 兩者都是全域設定（見 settings-schema 的 GLOBAL_CATEGORIES），登入前讀得到。
 */
function shouldEnhance() {
    return !!getFeature(isLandscape() ? 'horizontalLogin' : 'verticalLogin');
}

export function checkScene() {
    const scr = typeof CurrentScreen !== 'undefined' ? CurrentScreen : '';
    if (scr === 'Login' && shouldEnhance()) { if (!S.active) lceApply(); }
    else if (S.active) lceRemove();
}

// ── 視窗尺寸事件 ──────────────────────────────────────────────────────────

export function handleResize() {
    const scr = typeof CurrentScreen !== 'undefined' ? CurrentScreen : '';
    if (scr !== 'Login') return;
    if (!shouldEnhance()) { if (S.active) lceRemove(); return; }
    if (!S.active) lceApply();
    else { S.lastLayout = null; lceLayout(); }
}

/** 設定浮層切換「直式登入介面」後即時重套版面。 */
export function refreshOrientation() {
    const scr = typeof CurrentScreen !== 'undefined' ? CurrentScreen : '';
    if (scr !== 'Login') return;
    if (!shouldEnhance()) { if (S.active) lceRemove(); return; }
    if (!S.active) { lceApply(); return; }
    S.lastLayout = null;
    if (S.stageEl) S.stageEl.dataset.orient = '';   // 強制 lceLayout 重跑切換分支
    lceLayout();
}
