// ════════════════════════════════════════════════════════════════════════════
// 設定浮層（建構 + 開關 + 套用顯示設定）
// 事件綁定集中在 login-ui.bindEvents，此模組只負責 DOM 與純顯示邏輯，避免循環相依。
// ════════════════════════════════════════════════════════════════════════════

import { S } from '../core/state.js';
import { T, i18nPlaceholder } from '../core/i18n.js';
import { mk } from '../core/util.js';
import { getFeature } from '../core/feature-settings.js';
import { WALLPAPER_UPLOAD_SENTINEL } from '../core/constants.js';
import { getBackgroundList } from './background.js';

/** 建立設定浮層（固定置中，非 stage 座標） */
export function buildSettingsOverlay() {
    if (document.getElementById('lce-settings-overlay')) return;
    const overlay = mk('div', '', { id: 'lce-settings-overlay' });
    const box     = mk('div', '', { id: 'lce-settings-box' });

    const title = mk('div', '', { textContent: T('settings_title') });
    title.className = 'lce-sett-title'; title.dataset.lceKey = 'settings_title';
    box.appendChild(title);

    // 1. 橫式 / 直式登入介面
    // 這兩項是 LCE 的功能設定（schema 的 ui 分類），不是登入頁的區域設定。
    // 因為 ui/theme 是全域共用（見 settings-schema 的 GLOBAL_CATEGORIES），登入前也讀寫得到，
    // 所以這裡跟遊戲內設定頁改的是同一份值，兩邊都能設定。
    const mkFeatureRow = (labelKey, id, key) => {
        const row = mk('div'); row.className = 'lce-sett-row';
        const lbl = mk('span', '', { textContent: T(labelKey) }); lbl.dataset.lceKey = labelKey;
        const cb  = mk('input', '', { id, type: 'checkbox' }); cb.checked = !!getFeature(key);
        row.appendChild(lbl); row.appendChild(cb);
        return row;
    };
    box.appendChild(mkFeatureRow('s_horizontalLogin', 'lce-set-horizontal', 'horizontalLogin'));
    box.appendChild(mkFeatureRow('s_verticalLogin',   'lce-set-vertical',   'verticalLogin'));

    // 1b. 登入介面色系（同樣是全域設定，與遊戲內「UI 設置」改的是同一份值）
    const rowAccent = mk('div'); rowAccent.className = 'lce-sett-row';
    const lblAccent = mk('span', '', { textContent: T('s_loginAccentColor') });
    lblAccent.dataset.lceKey = 's_loginAccentColor';
    const inAccent = mk('input', '', { id: 'lce-set-accent', type: 'color' });
    inAccent.className = 'lce-sett-color';
    inAccent.value = getFeature('loginAccentColor') ?? '#7214ff';
    rowAccent.appendChild(lblAccent); rowAccent.appendChild(inAccent);
    box.appendChild(rowAccent);

    // 2. 帳號保存顯示（頭像 / 帳號 / 名稱，三個獨立開關）
    const mkShowRow = (labelKey, id, checked) => {
        const row = mk('div'); row.className = 'lce-sett-row';
        const lbl = mk('span', '', { textContent: T(labelKey) }); lbl.dataset.lceKey = labelKey;
        const cb  = mk('input', '', { id, type: 'checkbox' }); cb.checked = checked;
        row.appendChild(lbl); row.appendChild(cb);
        return row;
    };
    box.appendChild(mkShowRow('set_show_avatar',  'lce-set-avatar',  S.settings.showAvatar));
    box.appendChild(mkShowRow('set_show_account', 'lce-set-account', S.settings.showAccount));
    box.appendChild(mkShowRow('set_show_name',    'lce-set-name',    S.settings.showName));

    // 3. 背景模式
    const rowBg = mk('div'); rowBg.className = 'lce-sett-row';
    const lblBg = mk('span', '', { textContent: T('set_bg') }); lblBg.dataset.lceKey = 'set_bg';
    const selBg = mk('select', '', { id: 'lce-set-bgmode' });
    const optRandom = mk('option', '', { value: 'random', textContent: T('bg_random') }); optRandom.dataset.lceKey = 'bg_random';
    const optSelect = mk('option', '', { value: 'select', textContent: T('bg_select') }); optSelect.dataset.lceKey = 'bg_select';
    const optCustom = mk('option', '', { value: 'custom', textContent: T('bg_custom') }); optCustom.dataset.lceKey = 'bg_custom';
    selBg.appendChild(optRandom); selBg.appendChild(optSelect); selBg.appendChild(optCustom);
    selBg.value = S.settings.bgMode;
    rowBg.appendChild(lblBg); rowBg.appendChild(selBg);
    box.appendChild(rowBg);

    // 3b. 背景名稱（僅 select 模式顯示）
    const rowBgName = mk('div'); rowBgName.className = 'lce-sett-row lce-sett-sub'; rowBgName.id = 'lce-set-bgname-row';
    const lblBgName = mk('span', '', { textContent: '›' });
    const selBgName = mk('select', '', { id: 'lce-set-bgname' });
    getBackgroundList().forEach(name => {
        const o = mk('option', '', { value: name, textContent: name });
        if (name === S.settings.bgName) o.selected = true;
        selBgName.appendChild(o);
    });
    rowBgName.appendChild(lblBgName); rowBgName.appendChild(selBgName);
    rowBgName.style.display = S.settings.bgMode === 'select' ? '' : 'none';
    box.appendChild(rowBgName);

    // 3c. 自訂桌布（僅 custom 模式顯示）：填網址，或上傳一張存進瀏覽器的 DB。
    // 兩者共用 bgCustomUrl 一個欄位 —— 上傳時存的是 WALLPAPER_UPLOAD_SENTINEL，
    // 代表「用 DB 裡那張」，所以最後動的那個來源就是生效的那個，不必再開一個「來源」選單。
    const rowCustom = mk('div'); rowCustom.className = 'lce-sett-row lce-sett-sub'; rowCustom.id = 'lce-set-bgcustom-row';
    rowCustom.style.flexDirection = 'column'; rowCustom.style.alignItems = 'stretch'; rowCustom.style.gap = '8px';

    const urlIn = mk('input', '', { id: 'lce-set-bgurl', type: 'text' });
    urlIn.className = 'lce-sett-text';
    i18nPlaceholder(urlIn, 'bg_url_ph');
    urlIn.value = S.settings.bgCustomUrl === WALLPAPER_UPLOAD_SENTINEL ? '' : (S.settings.bgCustomUrl || '');
    rowCustom.appendChild(urlIn);

    const btnRow = mk('div'); btnRow.className = 'lce-sett-btnrow';
    // 真正的 file input 藏起來，用按鈕代打 —— 原生的 file input 樣式改不動，
    // 直接放上去跟整個浮層格格不入。
    const fileIn = mk('input', '', { id: 'lce-set-bgfile', type: 'file', accept: 'image/*' });
    fileIn.style.display = 'none';
    const upBtn = mk('button', '', { id: 'lce-set-bgupload', textContent: T('bg_upload') });
    upBtn.className = 'lce-sett-mini'; upBtn.dataset.lceKey = 'bg_upload';
    const clrBtn = mk('button', '', { id: 'lce-set-bgclear', textContent: T('bg_clear') });
    clrBtn.className = 'lce-sett-mini'; clrBtn.dataset.lceKey = 'bg_clear';
    btnRow.appendChild(upBtn); btnRow.appendChild(clrBtn); btnRow.appendChild(fileIn);
    rowCustom.appendChild(btnRow);

    const hint = mk('div', '', { id: 'lce-set-bghint' }); hint.className = 'lce-sett-hint';
    rowCustom.appendChild(hint);

    rowCustom.style.display = S.settings.bgMode === 'custom' ? 'flex' : 'none';
    box.appendChild(rowCustom);

    const close = mk('button', '', { id: 'lce-sett-close', textContent: T('settings_close') });
    close.className = 'lce-sett-close'; close.dataset.lceKey = 'settings_close';
    box.appendChild(close);

    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSettings(); });
    document.body.appendChild(overlay);
}

export function toggleSettings() {
    S.settingsOpen = !S.settingsOpen;
    document.getElementById('lce-settings-overlay')?.classList.toggle('visible', S.settingsOpen);
}

export function closeSettings() {
    S.settingsOpen = false;
    document.getElementById('lce-settings-overlay')?.classList.remove('visible');
}

/** 依設定套用頭像 / 帳號 / 名稱 的顯示（透過 stage class 控制，見 CSS） */
export function applyShowSettings() {
    if (!S.stageEl) return;
    S.stageEl.classList.toggle('lce-hide-avatar',  !S.settings.showAvatar);
    S.stageEl.classList.toggle('lce-hide-account', !S.settings.showAccount);
    S.stageEl.classList.toggle('lce-hide-name',    !S.settings.showName);
}
