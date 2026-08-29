import { byteSize, enableMomentumScroll, positionElement } from '../core/util.js';
import { T } from '../core/i18n.js';

const ROOT_ID = 'lce-storage-manager';
const STYLE_ID = 'lce-storage-manager-style';
const STORE_TYPES = ['extensionSettings', 'onlineSharedSettings', 'localStorage'];

function storeObject(type) {
    if (type === 'extensionSettings') return (typeof Player !== 'undefined' && Player?.ExtensionSettings) || null;
    if (type === 'onlineSharedSettings') return (typeof Player !== 'undefined' && Player?.OnlineSharedSettings) || null;
    if (type === 'localStorage') return typeof localStorage !== 'undefined' ? localStorage : null;
    return null;
}

function storeRows(type) {
    const store = storeObject(type);
    if (!store) return [];
    const entries = type === 'localStorage'
        ? Array.from({ length: store.length }, (_, index) => store.key(index)).filter(Boolean).map(key => [key, store.getItem(key)])
        : Object.entries(store);
    return entries.filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => ({ key, value, size: byteSize(value) })).sort((a, b) => b.size - a.size);
}

function readValue(type, key) {
    const store = storeObject(type);
    if (!store) return undefined;
    return type === 'localStorage' ? store.getItem(key) : store[key];
}

function syncStore(type, key) {
    if (type === 'extensionSettings') {
        if (typeof ServerPlayerExtensionSettingsSync === 'function') ServerPlayerExtensionSettingsSync(key);
    } else if (type === 'onlineSharedSettings') {
        if (typeof ServerAccountUpdate !== 'undefined') ServerAccountUpdate?.QueueData?.({ OnlineSharedSettings: Player.OnlineSharedSettings });
    }
}

function writeValue(type, key, value) {
    const store = storeObject(type);
    if (!store) throw new Error(`${type} is unavailable`);
    if (type === 'localStorage') store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    else store[key] = value;
    syncStore(type, key);
}

function deleteValue(type, key) {
    const store = storeObject(type);
    if (!store) return;
    if (type === 'localStorage') { store.removeItem(key); return; }
    if (!(key in store)) return;
    if (type === 'extensionSettings') { store[key] = null; syncStore(type, key); }
    delete store[key];
    if (type === 'onlineSharedSettings') syncStore(type, key);
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function displayValue(value) {
    if (value === undefined) return T('storage_value_missing');
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function safeFilename(value) { return String(value || 'account').replace(/[^a-z0-9._-]+/giu, '_'); }

function downloadBackup(type, selectedRows, suffix) {
    if (!selectedRows.length) return;
    const payload = {
        format: 'LCE storage backup', version: 2, storage: type, createdAt: new Date().toISOString(),
        account: Player?.AccountName ?? null, memberNumber: Player?.MemberNumber ?? null,
        data: Object.fromEntries(selectedRows.map(({ key, value }) => [key, value])),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LCE-${safeFilename(type)}-${safeFilename(Player?.AccountName)}-${safeFilename(suffix)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseBackup(text) {
    const parsed = JSON.parse(text);
    let type;
    let data;
    if (parsed?.format === 'LCE storage backup' && parsed.version === 2 && STORE_TYPES.includes(parsed.storage)) {
        type = parsed.storage; data = parsed.data;
    } else if (parsed?.format === 'LCE ExtensionSettings backup' && parsed.version === 1) {
        type = 'extensionSettings'; data = parsed.extensionSettings;
    } else throw new TypeError('Invalid LCE storage backup');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Invalid storage entries');
    const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
    const entries = Object.entries(data);
    if (!entries.length || entries.some(([key, value]) => !key || blockedKeys.has(key) || value === undefined)) throw new TypeError('Invalid storage entries');
    return { type, rows: entries.map(([key, value]) => ({ key, value, size: byteSize(value) })) };
}

function button(text, className, onClick) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = className; element.textContent = text;
    element.addEventListener('click', onClick); return element;
}

function checkbox(checked, onChange, label) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked;
    if (label) input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked)); return input;
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:absolute;z-index:100;display:flex;flex-direction:column;overflow:hidden;background:var(--lce-main,#202124);color:var(--lce-text,#f2f2f2);border:2px solid var(--lce-accent,#8ab4f8);border-radius:18px;box-shadow:0 24px 80px #000b;font:16px Arial,sans-serif}
#${ROOT_ID} *{box-sizing:border-box}.lce-storage-head{display:flex;gap:16px;align-items:center;padding:14px 24px 0;border-bottom:1px solid #ffffff2e}.lce-storage-title{display:flex;align-self:stretch;gap:6px;flex:1}.lce-storage-tab{padding:12px 16px;border:0;border-bottom:3px solid transparent;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer;opacity:.68}.lce-storage-tab:hover{opacity:1;background:#ffffff0a}.lce-storage-tab.active{opacity:1;border-bottom-color:var(--lce-accent,#8ab4f8);color:var(--lce-accent,#8ab4f8)}.lce-storage-summary{opacity:.75;white-space:nowrap}
.lce-storage-toolbar{display:flex;gap:10px;padding:14px 24px;background:#ffffff0a}.lce-storage-search{flex:1;min-width:120px;padding:10px 14px;border:1px solid #ffffff35;border-radius:10px;background:#0004;color:inherit;font:inherit}
.lce-storage-list{overflow:auto;touch-action:pan-x;padding:0 24px 24px;cursor:grab}.lce-storage-list.lce-drag-scrolling{cursor:grabbing;user-select:none}.lce-storage-columns,.lce-storage-row{display:grid;grid-template-columns:56px minmax(180px,1fr) 110px minmax(210px,auto);gap:12px;align-items:center}.lce-storage-columns{position:sticky;top:0;z-index:2;padding:12px 16px;background:var(--lce-main,#202124);border-bottom:1px solid #ffffff2e;font-weight:700}.lce-storage-select-all{display:flex;align-items:center;gap:7px;white-space:nowrap}.lce-storage-batch{display:flex;align-items:center;justify-content:flex-end;gap:8px}.lce-storage-batch>span{margin-right:auto}.lce-storage-row{padding:14px 16px;margin:8px 0;background:#ffffff0d;border:1px solid #ffffff18;border-radius:12px}.lce-storage-row>input,.lce-storage-columns input,.lce-storage-import-row input{width:18px;height:18px;accent-color:var(--lce-accent,#8ab4f8)}
.lce-storage-key{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.lce-storage-size{opacity:.72;text-align:right}.lce-storage-actions{display:flex;justify-content:flex-end;gap:8px}.lce-storage-btn{padding:9px 13px;border:0;border-radius:9px;cursor:pointer;background:#ffffff20;color:inherit;font-weight:650}.lce-storage-btn:hover{filter:brightness(1.2)}.lce-storage-btn:disabled{cursor:not-allowed;opacity:.4;filter:none}.lce-storage-danger{background:#d84b4b;color:#fff}.lce-storage-confirm{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:8px;color:#ffb4ab}.lce-storage-empty{text-align:center;padding:60px;opacity:.7}
.lce-storage-modal-backdrop{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:28px;background:#000b}.lce-storage-modal{display:flex;max-height:100%;width:min(1500px,100%);flex-direction:column;overflow:hidden;border:1px solid var(--lce-accent,#8ab4f8);border-radius:14px;background:var(--lce-main,#202124);box-shadow:0 20px 60px #000}.lce-storage-modal-head{padding:16px 20px;border-bottom:1px solid #ffffff2e;font-size:1.2rem;font-weight:700}.lce-storage-import-list{overflow:auto;padding:10px 18px}.lce-storage-import-columns,.lce-storage-import-row{display:grid;grid-template-columns:56px minmax(150px,.7fr) minmax(220px,1fr) minmax(220px,1fr);gap:10px;align-items:start}.lce-storage-import-columns{position:sticky;top:-10px;z-index:1;padding:10px;background:var(--lce-main,#202124);font-weight:700}.lce-storage-import-row{padding:10px;border-top:1px solid #ffffff18}.lce-storage-import-value{max-height:110px;overflow:auto;margin:0;padding:8px;border-radius:7px;background:#0005;white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,Consolas,monospace}.lce-storage-modal-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #ffffff2e}.lce-storage-modal-actions span{margin-right:auto;opacity:.8}
@media(max-width:800px){.lce-storage-head{align-items:stretch;flex-direction:column}.lce-storage-title{overflow-x:auto}.lce-storage-summary{display:none}.lce-storage-toolbar{flex-wrap:wrap}.lce-storage-columns,.lce-storage-row{grid-template-columns:42px 1fr auto}.lce-storage-columns>:nth-child(3),.lce-storage-size{display:none}.lce-storage-columns>:nth-child(4),.lce-storage-actions{grid-column:2/-1}.lce-storage-import-columns,.lce-storage-import-row{grid-template-columns:36px 1fr}.lce-storage-import-columns>:nth-child(n+3),.lce-storage-import-value{grid-column:2}.lce-storage-import-columns>:nth-child(n+3){display:none}}
`;
    document.head.appendChild(style);
}

export function closeStorageManager() { document.getElementById(ROOT_ID)?.remove(); }
export function isStorageManagerOpen() { return !!document.getElementById(ROOT_ID); }
export function positionStorageManager() { positionElement(ROOT_ID, 32, 100, 175, 1790, 750); }

export function openStorageManager() {
    closeStorageManager(); injectStyle();
    let activeType = 'extensionSettings';
    const selected = new Set();
    const root = document.createElement('section'); root.id = ROOT_ID; root.setAttribute('aria-label', T('storage_title'));
    const head = document.createElement('header'); head.className = 'lce-storage-head';
    const tabs = document.createElement('nav'); tabs.className = 'lce-storage-title';
    const summary = document.createElement('div'); summary.className = 'lce-storage-summary'; head.append(tabs, summary);
    const toolbar = document.createElement('div'); toolbar.className = 'lce-storage-toolbar';
    const search = document.createElement('input'); search.className = 'lce-storage-search'; search.type = 'search'; search.placeholder = T('storage_search');
    const list = document.createElement('div'); list.className = 'lce-storage-list';
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true;

    const renderTabs = () => {
        tabs.replaceChildren();
        for (const type of STORE_TYPES) {
            const tab = button(T(`storage_tab_${type}`), `lce-storage-tab${type === activeType ? ' active' : ''}`, () => {
                if (type === activeType) return;
                activeType = type; selected.clear(); search.value = ''; renderTabs(); render();
            });
            tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(type === activeType)); tabs.appendChild(tab);
        }
    };
    const selectedRows = () => storeRows(activeType).filter(row => selected.has(row.key));

    const render = () => {
        const allRows = storeRows(activeType);
        const query = search.value.trim().toLocaleLowerCase();
        const visible = query ? allRows.filter(row => row.key.toLocaleLowerCase().includes(query)) : allRows;
        const total = allRows.reduce((sum, row) => sum + row.size, 0);
        summary.textContent = T('storage_summary').replace('{count}', String(allRows.length)).replace('{size}', formatBytes(total));
        for (const key of [...selected]) if (!allRows.some(row => row.key === key)) selected.delete(key);
        list.replaceChildren();
        const columns = document.createElement('div'); columns.className = 'lce-storage-columns';
        const selectAll = document.createElement('label'); selectAll.className = 'lce-storage-select-all';
        selectAll.append(checkbox(visible.length > 0 && visible.every(row => selected.has(row.key)), checked => {
            for (const row of visible) checked ? selected.add(row.key) : selected.delete(row.key); render();
        }, T('storage_select_all')), document.createTextNode(T('storage_select_all')));
        const nameHead = document.createElement('span'); nameHead.textContent = T('storage_column_name');
        const sizeHead = document.createElement('span'); sizeHead.textContent = T('storage_column_size');
        const batch = document.createElement('div'); batch.className = 'lce-storage-batch';
        const actionsHead = document.createElement('span'); actionsHead.textContent = T('storage_column_actions');
        const backupSelected = button(T('storage_backup_selected'), 'lce-storage-btn', () => downloadBackup(activeType, selectedRows(), 'selected'));
        const deleteSelected = button(T('storage_delete_selected'), 'lce-storage-btn lce-storage-danger', () => {
            const chosen = selectedRows();
            if (!chosen.length || !window.confirm(T('storage_delete_selected_confirm').replace('{count}', String(chosen.length)))) return;
            for (const row of chosen) deleteValue(activeType, row.key);
            selected.clear(); render();
        });
        backupSelected.disabled = selected.size === 0; deleteSelected.disabled = selected.size === 0;
        batch.append(actionsHead, backupSelected, deleteSelected); columns.append(selectAll, nameHead, sizeHead, batch); list.appendChild(columns);
        if (!visible.length) {
            const empty = document.createElement('div'); empty.className = 'lce-storage-empty'; empty.textContent = T('storage_empty_generic'); list.appendChild(empty); return;
        }
        for (const row of visible) {
            const card = document.createElement('article'); card.className = 'lce-storage-row';
            card.appendChild(checkbox(selected.has(row.key), checked => { checked ? selected.add(row.key) : selected.delete(row.key); render(); }, row.key));
            const key = document.createElement('div'); key.className = 'lce-storage-key'; key.textContent = row.key;
            const size = document.createElement('div'); size.className = 'lce-storage-size'; size.textContent = formatBytes(row.size);
            const actions = document.createElement('div'); actions.className = 'lce-storage-actions';
            actions.append(button(T('storage_backup'), 'lce-storage-btn', () => downloadBackup(activeType, [row], row.key)),
                button(T('storage_delete'), 'lce-storage-btn lce-storage-danger', () => {
                    if (card.querySelector('.lce-storage-confirm')) return;
                    const confirm = document.createElement('div'); confirm.className = 'lce-storage-confirm';
                    const warning = document.createElement('span'); warning.textContent = T('storage_delete_confirm').replace('{key}', row.key);
                    confirm.append(warning, button(T('storage_cancel'), 'lce-storage-btn', () => confirm.remove()),
                        button(T('storage_delete_now'), 'lce-storage-btn lce-storage-danger', () => { deleteValue(activeType, row.key); selected.delete(row.key); render(); }));
                    card.appendChild(confirm);
                }));
            card.append(key, size, actions); list.appendChild(card);
        }
    };

    const showImportDialog = parsed => {
        activeType = parsed.type; selected.clear(); renderTabs(); render();
        const chosen = new Set();
        const backdrop = document.createElement('div'); backdrop.className = 'lce-storage-modal-backdrop';
        const modal = document.createElement('section'); modal.className = 'lce-storage-modal';
        const modalHead = document.createElement('div'); modalHead.className = 'lce-storage-modal-head'; modalHead.textContent = T('storage_import_review');
        const importList = document.createElement('div'); importList.className = 'lce-storage-import-list';
        const columns = document.createElement('div'); columns.className = 'lce-storage-import-columns';
        for (const label of ['storage_column_select', 'storage_column_name', 'storage_column_current', 'storage_column_replacement']) {
            const span = document.createElement('span'); span.textContent = T(label); columns.appendChild(span);
        }
        importList.appendChild(columns);
        const actions = document.createElement('div'); actions.className = 'lce-storage-modal-actions';
        const count = document.createElement('span');
        const importButton = button(T('storage_import_now'), 'lce-storage-btn', () => {
            const picked = parsed.rows.filter(row => chosen.has(row.key));
            if (!picked.length) return;
            try {
                for (const row of picked) writeValue(parsed.type, row.key, row.value);
                backdrop.remove(); render();
            } catch (error) {
                console.warn('[LCE] Storage import failed:', error); count.textContent = T('storage_import_failed');
            }
        });
        const refreshCount = () => {
            count.textContent = T('storage_import_selected').replace('{count}', String(chosen.size)); importButton.disabled = chosen.size === 0;
        };
        for (const row of parsed.rows) {
            const line = document.createElement('div'); line.className = 'lce-storage-import-row';
            line.appendChild(checkbox(false, checked => { checked ? chosen.add(row.key) : chosen.delete(row.key); refreshCount(); }, row.key));
            const name = document.createElement('div'); name.className = 'lce-storage-key'; name.textContent = row.key;
            const current = document.createElement('pre'); current.className = 'lce-storage-import-value'; current.textContent = displayValue(readValue(parsed.type, row.key));
            const replacement = document.createElement('pre'); replacement.className = 'lce-storage-import-value'; replacement.textContent = displayValue(row.value);
            line.append(name, current, replacement); importList.appendChild(line);
        }
        actions.append(count, button(T('storage_cancel'), 'lce-storage-btn', () => backdrop.remove()), importButton);
        modal.append(modalHead, importList, actions); backdrop.appendChild(modal); root.appendChild(backdrop); refreshCount();
    };

    toolbar.append(search,
        button(T('storage_backup_all'), 'lce-storage-btn', () => downloadBackup(activeType, storeRows(activeType), 'all')),
        button(T('storage_import'), 'lce-storage-btn', () => fileInput.click()),
        button(T('storage_refresh'), 'lce-storage-btn', render));
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
        try { showImportDialog(parseBackup(await file.text())); }
        catch (error) { console.warn('[LCE] Invalid storage backup:', error); window.alert(T('storage_import_invalid')); }
    });
    search.addEventListener('input', render);
    root.append(head, toolbar, fileInput, list); document.body.appendChild(root);
    enableMomentumScroll(list); positionStorageManager(); renderTabs(); render();
}
