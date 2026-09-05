import { fSettings, setFeature, saveFeatureSettings } from '../core/feature-settings.js';
import { DEFAULT_FEATURE_SETTINGS } from '../core/settings-schema.js';
import { gameLanguages } from '../game/language.js';
import { T } from '../core/i18n.js';
import { listSystemFonts } from '../features/theme/theme-font.js';

export function langLabel(code) {
    const { codes, labels } = gameLanguages();
    const i = codes.indexOf(code);
    return i >= 0 ? labels[i] : String(code ?? '');
}

let langPickerOpen = false;

/**
 * 開出「遊戲語言」下拉清單（canvas 設定頁上的 HTML 覆蓋層，與字型/調色器同一套做法）。
 * 直接點選要的語言即可，不必用 ◀▶ 一個個繞。語言清單取自 BC 的 TranslationDictionary。
 */
export function openLanguagePicker(key, def) {
    if (langPickerOpen) return;
    langPickerOpen = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'lce-langpicker-backdrop';
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        width: 'min(420px,90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: 'var(--lce-main,#222)', color: 'var(--lce-text,#eee)',
        border: '2px solid var(--lce-login-accent,#7214ff)', borderRadius: '8px',
        overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        // 國旗:與登入頁同招,白嫖 BC country-flag polyfill 注入的 "Twemoji Country Flags"
        // @font-face;heading 與每個語言 row 都繼承此棧,國旗碼點用它、文字 fallback 到後面。
        fontFamily: '"Twemoji Country Flags",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif',
    });

    const heading = document.createElement('div');
    heading.textContent = T(def.label);
    Object.assign(heading.style, {
        padding: '10px', borderBottom: '1px solid var(--lce-login-accent,#7214ff)',
        background: 'var(--lce-element,#111)', fontSize: '16px', fontWeight: 'bold',
    });

    const listWrap = document.createElement('div');
    Object.assign(listWrap.style, { overflowY: 'auto', overflowX: 'hidden', padding: '8px' });

    panel.append(heading, listWrap);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const close = () => {
        langPickerOpen = false;
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    panel.addEventListener('mousedown', e => e.stopPropagation());

    const pick = (code) => {
        if (code !== fSettings[key]) { setFeature(key, code); }
        close();
    };

    const { codes, labels } = gameLanguages();
    codes.forEach((code, i) => {
        const row = document.createElement('div');
        row.textContent = labels[i];
        const selected = fSettings[key] === code;
        Object.assign(row.style, {
            padding: '8px 10px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: selected ? 'var(--lce-login-accent,#7214ff)' : '',
        });
        row.addEventListener('mouseenter', () => { if (!selected) row.style.background = 'var(--lce-element-hover,#3a3a3a)'; });
        row.addEventListener('mouseleave', () => { if (!selected) row.style.background = ''; });
        row.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(code); });
        listWrap.appendChild(row);
    });
}

let fontPickerOpen = false;

/** 開出「系統已安裝字型」的 HTML 下拉清單（canvas 設定頁上的覆蓋層，與調色器同一套做法）。 */
export function openFontPicker(key, def) {
    if (fontPickerOpen) return;
    fontPickerOpen = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'lce-fontpicker-backdrop';
    Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '10000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        width: 'min(520px,90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: 'var(--lce-main,#222)', color: 'var(--lce-text,#eee)',
        border: '2px solid var(--lce-login-accent,#7214ff)', borderRadius: '8px',
        overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
    });

    const search = document.createElement('input');
    search.type = 'text';
    search.setAttribute('placeholder', T('themeFont_search'));
    Object.assign(search.style, {
        padding: '10px', border: '0', borderBottom: '1px solid var(--lce-login-accent,#7214ff)',
        background: 'var(--lce-element,#111)', color: 'inherit', fontSize: '16px',
    });

    const listWrap = document.createElement('div');
    Object.assign(listWrap.style, { overflowY: 'auto', overflowX: 'hidden', padding: '8px' });
    listWrap.textContent = '…';

    panel.append(search, listWrap);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const close = () => {
        fontPickerOpen = false;
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    // 別讓點擊/輸入穿到底下的 BC canvas
    panel.addEventListener('mousedown', e => e.stopPropagation());
    search.addEventListener('keydown', e => e.stopPropagation());

    const pick = (name) => { setFeature(key, name); close(); };

    const makeRow = (label, value, previewFont) => {
        const row = document.createElement('div');
        row.textContent = label;
        const selected = fSettings[key] === value;
        Object.assign(row.style, {
            padding: '8px 10px', cursor: 'pointer', borderRadius: '4px', fontSize: '18px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: selected ? 'var(--lce-login-accent,#7214ff)' : '',
        });
        if (previewFont) row.style.fontFamily = /\s/.test(previewFont) ? `"${previewFont}"` : previewFont;
        row.addEventListener('mouseenter', () => { if (!selected) row.style.background = 'var(--lce-element-hover,#3a3a3a)'; });
        row.addEventListener('mouseleave', () => { if (!selected) row.style.background = ''; });
        row.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(value); });
        return row;
    };

    let allFonts = [];
    const render = (filter = '') => {
        listWrap.textContent = '';
        listWrap.appendChild(makeRow(T('themeFont_default'), '', ''));   // 清除 → 用預設字型
        const f = filter.trim().toLowerCase();
        for (const name of allFonts) {
            if (f && !name.toLowerCase().includes(f)) continue;
            listWrap.appendChild(makeRow(name, name, name));
        }
    };
    search.addEventListener('input', () => render(search.value));

    listSystemFonts()
        .then((fonts) => { allFonts = fonts; render(); search.focus(); })
        .catch((e) => { listWrap.textContent = String(e?.message ?? e); });
}

export function promptInput(key, def) {
    const next = window.prompt(T(def.label), String(fSettings[key] ?? ''));
    if (next !== null) { setFeature(key, next); }
}

let colorPickerOpen = false;

/** 叫出 BC 內建調色器（跟 Themed 一樣）。無此 API 時退回瀏覽器原生調色器。 */
export function openColorPicker(key, def) {
    const cur = /^#([0-9a-fA-F]{6})$/.test(fSettings[key]) ? fSettings[key] : '#000000';

    if (typeof ColorPickerInit === 'function' && typeof ColorPicker === 'object') {
        if (colorPickerOpen) return;
        colorPickerOpen = true;
        const paddingTop = 75;
        const paddingRight = 2000 - (1815 + 90);
        const shape = [2000 - ColorPicker.defaultShape[2] - paddingRight + 25, paddingTop, ColorPicker.defaultShape[2], 1000 - paddingTop * 2];
        ColorPickerInit({
            colorState: { colors: [cur], defaultColors: [DEFAULT_FEATURE_SETTINGS[key]?.value ?? '#ffffff'], opacity: [1], editOpacity: false },
            heading: T(def.label),
            shape,
            // BC 呼叫 onInput 的簽名是 (inputElement, event)，不是狀態物件；
            // 跟 Themed 一樣設為 no-op，顏色只在 onExit（(state, save, root)）套用。
            onInput: () => null,
            onExit: (state, save) => {
                if (save && state?.colors) { setFeature(key, state.colors[0]); }
                colorPickerOpen = false;
                document.getElementById('lce-colorpicker-backdrop')?.toggleAttribute('hidden', true);
            },
        }).then((el) => {
            let backdrop = document.getElementById('lce-colorpicker-backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'lce-colorpicker-backdrop';
                Object.assign(backdrop.style, { backgroundColor: 'rgba(0,0,0,0.3)', width: '100%', height: '100%', position: 'absolute', top: '0', left: '0' });
                backdrop.appendChild(el);
                document.body.appendChild(backdrop);
            } else {
                backdrop.toggleAttribute('hidden', false);
            }
        }).catch(() => { colorPickerOpen = false; });
        return;
    }

    // fallback：瀏覽器原生調色器
    const input = document.createElement('input');
    input.type = 'color';
    input.value = cur;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(input);
    const apply = () => { setFeature(key, input.value, { persist: false }); };
    input.addEventListener('input', apply);
    input.addEventListener('change', () => { apply(); saveFeatureSettings(); input.remove(); });
    input.click();
}

