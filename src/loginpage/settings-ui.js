// ════════════════════════════════════════════════════════════════════════════
// 設定浮層（建構 + 開關 + 套用顯示設定）
// 事件綁定集中在 login-ui.bindEvents，此模組只負責 DOM 與純顯示邏輯，避免循環相依。
// ════════════════════════════════════════════════════════════════════════════

import { S } from '../core/state.js';
import { T } from '../core/i18n.js';
import { mk } from '../core/util.js';
import { getBackgroundList } from './background.js';

/** 建立設定浮層（固定置中，非 stage 座標） */
export function buildSettingsOverlay() {
    if (document.getElementById('lce-settings-overlay')) return;
    const overlay = mk('div', '', { id: 'lce-settings-overlay' });
    const box     = mk('div', '', { id: 'lce-settings-box' });

    const title = mk('div', '', { textContent: T('settings_title') });
    title.className = 'lce-sett-title'; title.dataset.lceKey = 'settings_title';
    box.appendChild(title);

    // 1. 登入介面增強
    const rowEnhance = mk('div'); rowEnhance.className = 'lce-sett-row';
    const lblEnhance = mk('span', '', { textContent: T('set_enhance') }); lblEnhance.dataset.lceKey = 'set_enhance';
    const cbEnhance  = mk('input', '', { id: 'lce-set-enhance', type: 'checkbox' }); cbEnhance.checked = S.settings.enhance;
    rowEnhance.appendChild(lblEnhance); rowEnhance.appendChild(cbEnhance);
    box.appendChild(rowEnhance);

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
    selBg.appendChild(optRandom); selBg.appendChild(optSelect);
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
