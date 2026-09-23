// Login owns its picker so another plugin's older shared Flags engine cannot
// replace viewport anchoring or theme styling. Flag assets still use the shared cache.
function parts(label) {
    const match = label.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    return match ? { emoji: match[0], country: [...match[0]].map(c => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 97)).join('') } : null;
}
const create = async country => window.Liko.__Sys_Flags__.create(country);
function renderLabel(element, label) {
    const flags = window.Liko?.__Sys_Flags__;
    if (flags?.renderLabel) flags.renderLabel(element, label);
    else element.textContent = label;
}
const selects = new WeakMap();
let closePicker = null;
export function closeLoginLanguageMenu() { closePicker?.(); }
export function bindLoginLanguageSelect(select) {
    if (select.multiple || select.size > 1) return;
    if (selects.has(select)) { selects.get(select)(); return; }
    const original = { backgroundImage: select.style.backgroundImage, backgroundRepeat: select.style.backgroundRepeat,
        backgroundPosition: select.style.backgroundPosition, backgroundSize: select.style.backgroundSize, paddingLeft: select.style.paddingLeft };
    const savedLabels = new Map();
    let sequence = 0;
    let signature = '';
    let selectedNode = null;
    const sync = () => {
        const next = JSON.stringify([select.value, [...select.options].map(o => [o.value, savedLabels.get(o) || o.label])]);
        if (next === signature && selectedNode === select.selectedOptions[0]) return;
        signature = next;
        selectedNode = select.selectedOptions[0];
        const stamp = ++sequence;
        for (const [option, label] of savedLabels) { option.label = label; }
        savedLabels.clear();
        Object.assign(select.style, original);
        const option = select.selectedOptions[0];
        const label = option?.label || '';
        const flag = parts(label);
        if (!flag) return;
        create(flag.country).then(img => {
            img.onload = () => {
                if (stamp !== sequence || select.selectedOptions[0] !== option) return;
                savedLabels.set(option, label);
                option.label = label.replace(flag.emoji, '').trim();
                Object.assign(select.style, { backgroundImage: `url("${img.src}")`, backgroundRepeat: 'no-repeat', backgroundPosition: '6px center', backgroundSize: '1.33em 1em', paddingLeft: '1.9em' });
            };
            if (img.complete && img.naturalWidth) img.onload();
        }).catch(() => {});
    };
    const open = event => {
        if (select.disabled || ![...select.options].some(o => parts(savedLabels.get(o) || o.label))) return;
        if (event.type === 'keydown' && ![' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        closePicker?.();
        const rect = select.getBoundingClientRect();
        const menu = document.createElement('div');
        const style = getComputedStyle(select);
        if (select.id === 'lce-lang-select') menu.classList.add('lce-login-language-menu');
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', select.getAttribute('aria-label') || 'Language');
        menu.style.cssText = `position:fixed;z-index:2147483647;box-sizing:border-box;overflow:auto;max-height:45vh;padding:4px;border:1px solid currentColor;border-radius:6px;box-shadow:0 4px 16px #0008;`;
        const viewport = window.visualViewport;
        const vx = viewport?.offsetLeft || 0, vy = viewport?.offsetTop || 0;
        const vw = viewport?.width || innerWidth, vh = viewport?.height || innerHeight;
        const width = Math.max(0, Math.min(Math.max(rect.width, 180), vw - 8));
        const below = Math.max(0, vy + vh - rect.bottom - 7);
        const above = Math.max(0, rect.top - vy - 7);
        const upward = above > below;
        Object.assign(menu.style, {
            left: `${Math.max(vx + 4, Math.min(rect.left, vx + vw - width - 4))}px`,
            width: `${width}px`, maxHeight: `${Math.min(vh * .6, upward ? above : below)}px`,
            background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#222' : style.backgroundColor,
            color: style.color, font: style.font,
            fontSize: `${parseFloat(style.fontSize) * (rect.height / select.offsetHeight || 1)}px`,
        });
        const controller = new AbortController();
        let removalObserver;
        const close = () => {
            controller.abort(); removalObserver?.disconnect(); menu.remove();
            delete select.dataset.likoFlagPicker;
            select.setAttribute('aria-expanded', 'false');
            if (closePicker === close) closePicker = null;
            select.dispatchEvent(new Event('liko-flags-close'));
        };
        closePicker = close;
        select.dataset.likoFlagPicker = 'open';
        select.setAttribute('aria-expanded', 'true');
        const rows = [];
        for (const option of select.options) {
            const row = document.createElement('button');
            row.type = 'button'; row.disabled = option.disabled || !!option.parentElement?.disabled;
            row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected));
            row.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin:0;text-align:left;padding:7px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;';
            renderLabel(row, savedLabels.get(option) || option.label);
            row.onclick = () => { select.value = option.value; sync(); close(); select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); select.focus(); };
            menu.appendChild(row); if (!row.disabled) rows.push(row);
        }
        menu.onkeydown = e => {
            const index = rows.indexOf(document.activeElement);
            if (e.key === 'Escape') { e.preventDefault(); close(); select.focus(); }
            else if (e.key === 'Tab') close();
            else if (rows.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault(); rows[e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
            }
        };
        document.body.appendChild(menu);
        menu.style.bottom = 'auto';
        menu.style.top = `${Math.max(vy + 4, Math.min(upward ? rect.top - 3 - menu.getBoundingClientRect().height : rect.bottom + 3,
            vy + vh - menu.getBoundingClientRect().height - 4))}px`;
        removalObserver = new MutationObserver(() => { if (!select.isConnected || select.style.display === 'none') close(); });
        removalObserver.observe(document.body, { childList: true, subtree: true });
        removalObserver.observe(select, { attributes: true, attributeFilter: ['style'] });
        (menu.querySelector('[aria-selected="true"]:not(:disabled)') || rows[0])?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) close(); }, { capture: true, signal: controller.signal });
        window.addEventListener('resize', close, { signal: controller.signal });
        window.visualViewport?.addEventListener('resize', close, { signal: controller.signal });
        window.visualViewport?.addEventListener('scroll', close, { signal: controller.signal });
        window.addEventListener('scroll', e => { if (!menu.contains(e.target)) close(); }, { capture: true, signal: controller.signal });
    };
    select.addEventListener('pointerdown', open);
    select.addEventListener('keydown', open);
    select.addEventListener('change', sync);
    selects.set(select, sync);
    sync();
}
