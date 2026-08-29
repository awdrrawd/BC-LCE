import { T } from '../core/i18n.js';
import { enableMomentumScroll, positionElement } from '../core/util.js';
import { addTrustedOrigin, getTrustedOrigins, removeTrustedOrigin } from '../features/trusted-domains.js';

const ROOT_ID = 'lce-trusted-domain-manager';
const STYLE_ID = 'lce-trusted-domain-manager-style';

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:absolute;z-index:100;display:flex;flex-direction:column;overflow:hidden;background:var(--lce-main,#202124);color:var(--lce-text,#f2f2f2);border:2px solid var(--lce-accent,#8ab4f8);border-radius:18px;box-shadow:0 24px 80px #000b;font:16px Arial,sans-serif}
#${ROOT_ID} *{box-sizing:border-box}.lce-domain-head{padding:22px 28px 14px;border-bottom:1px solid #ffffff2e;font-size:1.35rem;font-weight:800}.lce-domain-toolbar{display:flex;gap:10px;padding:16px 28px;background:#ffffff0a}.lce-domain-input{flex:1;min-width:160px;padding:11px 14px;border:1px solid #ffffff35;border-radius:10px;background:#0004;color:inherit;font:inherit}.lce-domain-btn{padding:10px 15px;border:0;border-radius:9px;cursor:pointer;background:#ffffff20;color:inherit;font:inherit;font-weight:700}.lce-domain-btn:hover{filter:brightness(1.2)}.lce-domain-add{background:var(--lce-accent,#4d86c6);color:#fff}.lce-domain-delete{background:#b04444;color:#fff}.lce-domain-error{min-height:24px;padding:0 28px;color:#ffb4ab}.lce-domain-list{overflow:auto;touch-action:pan-x;padding:4px 28px 28px;cursor:grab}.lce-domain-list.lce-drag-scrolling{cursor:grabbing;user-select:none}.lce-domain-row{display:flex;align-items:center;gap:14px;padding:14px 16px;margin:9px 0;border:1px solid #ffffff18;border-radius:12px;background:#ffffff0d}.lce-domain-origin{flex:1;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace}.lce-domain-empty{padding:70px 20px;text-align:center;opacity:.7}
`;
    document.head.appendChild(style);
}

export function closeTrustedDomainManager() { document.getElementById(ROOT_ID)?.remove(); }
export function isTrustedDomainManagerOpen() { return !!document.getElementById(ROOT_ID); }
export function positionTrustedDomainManager() { positionElement(ROOT_ID, 32, 100, 175, 1790, 750); }

export function openTrustedDomainManager() {
    closeTrustedDomainManager(); injectStyle();
    const root = document.createElement('section'); root.id = ROOT_ID; root.setAttribute('aria-label', T('trusted_domains_title'));
    const head = document.createElement('header'); head.className = 'lce-domain-head'; head.textContent = T('trusted_domains_title');
    const toolbar = document.createElement('div'); toolbar.className = 'lce-domain-toolbar';
    const input = document.createElement('input'); input.className = 'lce-domain-input'; input.type = 'text'; input.placeholder = T('trusted_domains_placeholder');
    const add = document.createElement('button'); add.type = 'button'; add.className = 'lce-domain-btn lce-domain-add'; add.textContent = T('trusted_domains_add');
    const error = document.createElement('div'); error.className = 'lce-domain-error';
    const list = document.createElement('div'); list.className = 'lce-domain-list';
    const render = () => {
        list.replaceChildren();
        const origins = getTrustedOrigins();
        if (!origins.length) {
            const empty = document.createElement('div'); empty.className = 'lce-domain-empty'; empty.textContent = T('trusted_domains_empty'); list.appendChild(empty); return;
        }
        for (const origin of origins) {
            const row = document.createElement('article'); row.className = 'lce-domain-row';
            const text = document.createElement('span'); text.className = 'lce-domain-origin'; text.textContent = origin;
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'lce-domain-btn lce-domain-delete'; remove.textContent = T('trusted_domains_delete');
            remove.addEventListener('click', () => { removeTrustedOrigin(origin); render(); });
            row.append(text, remove); list.appendChild(row);
        }
    };
    const addValue = () => {
        error.textContent = '';
        if (!addTrustedOrigin(input.value)) { error.textContent = T('trusted_domains_invalid'); return; }
        input.value = ''; render(); input.focus();
    };
    add.addEventListener('click', addValue);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } });
    toolbar.append(input, add); root.append(head, toolbar, error, list); document.body.appendChild(root);
    enableMomentumScroll(list); positionTrustedDomainManager(); render(); input.focus();
}
