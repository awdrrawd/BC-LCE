import { byteSize, positionElement } from '../core/util.js';
import { T } from '../core/i18n.js';

const ROOT_ID = 'lce-storage-manager';
const STYLE_ID = 'lce-storage-manager-style';

const extensionSettings = () => (typeof Player !== 'undefined' && Player?.ExtensionSettings) || null;

function rows() {
    const settings = extensionSettings();
    if (!settings) return [];
    return Object.entries(settings)
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => ({ key, value, size: byteSize(value) }))
        .sort((a, b) => b.size - a.size);
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function safeFilename(value) {
    return String(value || 'account').replace(/[^a-z0-9._-]+/giu, '_');
}

function downloadBackup(selectedRows, suffix) {
    const payload = {
        format: 'LCE ExtensionSettings backup',
        version: 1,
        createdAt: new Date().toISOString(),
        account: Player?.AccountName ?? null,
        memberNumber: Player?.MemberNumber ?? null,
        extensionSettings: Object.fromEntries(selectedRows.map(({ key, value }) => [key, value])),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LCE-ExtensionSettings-${safeFilename(Player?.AccountName)}-${safeFilename(suffix)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function deleteSetting(key) {
    const settings = extensionSettings();
    if (!settings || !(key in settings)) return;
    settings[key] = null;
    if (typeof ServerPlayerExtensionSettingsSync === 'function') ServerPlayerExtensionSettingsSync(key);
    delete settings[key];
}

function parseBackup(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.format !== 'LCE ExtensionSettings backup' || parsed.version !== 1
        || !parsed.extensionSettings || typeof parsed.extensionSettings !== 'object'
        || Array.isArray(parsed.extensionSettings)) {
        throw new TypeError('Invalid LCE ExtensionSettings backup');
    }
    const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
    const entries = Object.entries(parsed.extensionSettings);
    if (!entries.length || entries.some(([key, value]) => !key || blockedKeys.has(key) || value === undefined)) {
        throw new TypeError('Invalid ExtensionSettings entries');
    }
    return entries.map(([key, value]) => ({ key, value, size: byteSize(value) }));
}

function importBackup(importRows) {
    const settings = extensionSettings();
    if (!settings) throw new Error('Player.ExtensionSettings is unavailable');
    for (const { key, value } of importRows) {
        settings[key] = value;
        if (typeof ServerPlayerExtensionSettingsSync === 'function') ServerPlayerExtensionSettingsSync(key);
    }
}

function button(text, className, onClick) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.addEventListener('click', onClick);
    return element;
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:absolute;z-index:100;display:flex;flex-direction:column;overflow:hidden;
background:var(--lce-main,#202124);color:var(--lce-text,#f2f2f2);border:2px solid var(--lce-accent,#8ab4f8);
border-radius:18px;box-shadow:0 24px 80px #000b;font:16px Arial,sans-serif}
#${ROOT_ID} *{box-sizing:border-box} .lce-storage-head{display:flex;gap:16px;align-items:center;padding:20px 24px;
border-bottom:1px solid #ffffff2e}.lce-storage-title{font-size:1.45rem;font-weight:700;flex:1}.lce-storage-summary{opacity:.75}
.lce-storage-toolbar{display:flex;gap:10px;padding:14px 24px;background:#ffffff0a}.lce-storage-search{flex:1;min-width:120px;
padding:10px 14px;border:1px solid #ffffff35;border-radius:10px;background:#0004;color:inherit;font:inherit}
.lce-storage-import-status:not(:empty){display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:12px 24px;
background:#8ab4f81a;border-top:1px solid #ffffff18;border-bottom:1px solid #ffffff18}.lce-storage-import-status span{margin-right:auto}
.lce-storage-list{overflow:auto;padding:12px 24px 24px}.lce-storage-row{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;
gap:12px;align-items:center;padding:14px 16px;margin:8px 0;background:#ffffff0d;border:1px solid #ffffff18;border-radius:12px}
.lce-storage-key{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.lce-storage-size{opacity:.72;min-width:90px;text-align:right}
.lce-storage-actions{display:flex;gap:8px}.lce-storage-btn{padding:9px 13px;border:0;border-radius:9px;cursor:pointer;
background:var(--lce-accent,#8ab4f8);color:#111;font-weight:650}.lce-storage-btn:hover{filter:brightness(1.12)}
.lce-storage-secondary{background:#ffffff20;color:inherit}.lce-storage-danger{background:#d84b4b;color:#fff}
.lce-storage-confirm{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:8px;color:#ffb4ab}
.lce-storage-empty{text-align:center;padding:60px;opacity:.7}@media(max-width:700px){.lce-storage-row{grid-template-columns:1fr auto}
.lce-storage-actions{grid-column:1/-1}.lce-storage-summary{display:none}.lce-storage-toolbar{flex-wrap:wrap}
.lce-storage-import-status:not(:empty){align-items:stretch;flex-direction:column}}
`;
    document.head.appendChild(style);
}

export function closeStorageManager() {
    document.getElementById(ROOT_ID)?.remove();
}

export function isStorageManagerOpen() {
    return !!document.getElementById(ROOT_ID);
}

/** Keep the DOM panel aligned to BC's 2000×1000 logical canvas. Called every settings frame. */
export function positionStorageManager() {
    positionElement(ROOT_ID, 32, 100, 175, 1790, 750);
}

export function openStorageManager() {
    closeStorageManager();
    injectStyle();
    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.setAttribute('aria-label', T('storage_title'));
    const head = document.createElement('header');
    head.className = 'lce-storage-head';
    const title = document.createElement('div');
    title.className = 'lce-storage-title';
    title.textContent = T('storage_title');
    const summary = document.createElement('div');
    summary.className = 'lce-storage-summary';
    head.append(title, summary);

    const toolbar = document.createElement('div');
    toolbar.className = 'lce-storage-toolbar';
    const search = document.createElement('input');
    search.className = 'lce-storage-search';
    search.type = 'search';
    search.placeholder = T('storage_search');
    const list = document.createElement('div');
    list.className = 'lce-storage-list';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    const importStatus = document.createElement('div');
    importStatus.className = 'lce-storage-import-status';

    const render = () => {
        const allRows = rows();
        const query = search.value.trim().toLocaleLowerCase();
        const visible = query ? allRows.filter(row => row.key.toLocaleLowerCase().includes(query)) : allRows;
        const total = allRows.reduce((sum, row) => sum + row.size, 0);
        summary.textContent = T('storage_summary').replace('{count}', String(allRows.length)).replace('{size}', formatBytes(total));
        list.replaceChildren();
        if (!visible.length) {
            const empty = document.createElement('div');
            empty.className = 'lce-storage-empty';
            empty.textContent = T('storage_empty');
            list.appendChild(empty);
            return;
        }
        for (const row of visible) {
            const card = document.createElement('article');
            card.className = 'lce-storage-row';
            const key = document.createElement('div');
            key.className = 'lce-storage-key'; key.textContent = row.key;
            const size = document.createElement('div');
            size.className = 'lce-storage-size'; size.textContent = formatBytes(row.size);
            const actions = document.createElement('div');
            actions.className = 'lce-storage-actions';
            actions.append(
                button(T('storage_backup'), 'lce-storage-btn lce-storage-secondary', () => downloadBackup([row], row.key)),
                button(T('storage_delete'), 'lce-storage-btn lce-storage-danger', () => {
                    if (card.querySelector('.lce-storage-confirm')) return;
                    const confirm = document.createElement('div');
                    confirm.className = 'lce-storage-confirm';
                    const warning = document.createElement('span');
                    warning.textContent = T('storage_delete_confirm').replace('{key}', row.key);
                    confirm.append(
                        warning,
                        button(T('storage_cancel'), 'lce-storage-btn lce-storage-secondary', () => confirm.remove()),
                        button(T('storage_delete_now'), 'lce-storage-btn lce-storage-danger', () => { deleteSetting(row.key); render(); }),
                    );
                    card.appendChild(confirm);
                }),
            );
            card.append(key, size, actions);
            list.appendChild(card);
        }
    };

    toolbar.append(
        search,
        button(T('storage_backup_all'), 'lce-storage-btn', () => downloadBackup(rows(), 'all')),
        button(T('storage_import'), 'lce-storage-btn', () => fileInput.click()),
        button(T('storage_refresh'), 'lce-storage-btn lce-storage-secondary', render),
    );
    fileInput.addEventListener('change', async () => {
        importStatus.replaceChildren();
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
            const importRows = parseBackup(await file.text());
            const total = importRows.reduce((sum, row) => sum + row.size, 0);
            const message = document.createElement('span');
            message.textContent = T('storage_import_confirm')
                .replace('{count}', String(importRows.length))
                .replace('{size}', formatBytes(total));
            importStatus.append(
                message,
                button(T('storage_cancel'), 'lce-storage-btn lce-storage-secondary', () => importStatus.replaceChildren()),
                button(T('storage_import_now'), 'lce-storage-btn', () => {
                    try {
                        importBackup(importRows);
                        importStatus.textContent = T('storage_import_done').replace('{count}', String(importRows.length));
                        render();
                    } catch (error) {
                        console.warn('[LCE] ExtensionSettings import failed:', error);
                        importStatus.textContent = T('storage_import_failed');
                    }
                }),
            );
        } catch (error) {
            console.warn('[LCE] Invalid ExtensionSettings backup:', error);
            importStatus.textContent = T('storage_import_invalid');
        }
    });
    search.addEventListener('input', render);
    root.append(head, toolbar, fileInput, importStatus, list);
    document.body.appendChild(root);
    positionStorageManager();
    render();
}
