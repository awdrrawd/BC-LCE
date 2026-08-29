import { T } from '../core/i18n.js';

const STORAGE_KEY = 'lce_trusted_image_origins';
const STYLE_ID = 'lce-trust-prompt-style';
const ROOT_ID = 'lce-trust-prompt';

export const sessionCustomOrigins = new Map();

export function normalizeOrigin(value) {
    try {
        const url = new URL(String(value).trim());
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.origin;
    } catch { return null; }
}

export function getTrustedOrigins() {
    try {
        const values = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return [...new Set((Array.isArray(values) ? values : []).map(normalizeOrigin).filter(Boolean))].sort();
    } catch { return []; }
}

function saveTrustedOrigins(values) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(values)].sort()));
    window.dispatchEvent(new CustomEvent('lce:trusted-origins-changed'));
}

export function isOriginTrusted(value) {
    const origin = normalizeOrigin(value);
    return !!origin && getTrustedOrigins().includes(origin);
}

export function addTrustedOrigin(value) {
    const origin = normalizeOrigin(value);
    if (!origin) return false;
    saveTrustedOrigins([...getTrustedOrigins(), origin]);
    sessionCustomOrigins.set(origin, 'allowed');
    return true;
}

export function removeTrustedOrigin(value) {
    const origin = normalizeOrigin(value);
    if (!origin) return false;
    saveTrustedOrigins(getTrustedOrigins().filter(item => item !== origin));
    return true;
}

function pcmModals() {
    const candidates = [window.Liko?.PCMApi?.modals, window.Liko?.PCM?.modals, window.PCM?.modals];
    return candidates.find(api => api && (typeof api.open === 'function' || typeof api.openAsync === 'function')) || null;
}

function promptText(origin, content) {
    return T('domain_prompt').replace('{content}', content).replace('{origin}', origin).replace('{trusted}', '');
}

function askViaPcm(api, origin, content, persistent) {
    const buttons = persistent
        ? { always: T('domain_always'), submit: T('domain_allow'), cancel: T('domain_deny') }
        : { submit: T('domain_allow'), cancel: T('domain_deny') };
    if (typeof api.openAsync === 'function') return api.openAsync({ prompt: promptText(origin, content), buttons }).then(([action]) => action);
    return new Promise(resolve => api.open({ prompt: promptText(origin, content), buttons, callback: resolve }));
}

function injectPromptStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:fixed;z-index:1200;left:50%;top:12px;width:min(900px,calc(100vw - 24px));transform:translate(-50%,0);padding:18px 20px;border:1px solid var(--lce-accent,#8ab4f8);border-radius:0 0 16px 16px;background:var(--lce-main,#202124);color:var(--lce-text,#f2f2f2);box-shadow:0 18px 55px #0009;font:16px Arial,sans-serif;animation:lce-trust-in .24s ease-out both}
#${ROOT_ID}.closing{animation:lce-trust-out .2s ease-in both}.lce-trust-message{line-height:1.5;overflow-wrap:anywhere}.lce-trust-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:15px;flex-wrap:wrap}.lce-trust-actions button{min-width:130px;padding:10px 16px;border:0;border-radius:9px;background:#ffffff20;color:inherit;font:inherit;font-weight:700;cursor:pointer}.lce-trust-actions button:hover{filter:brightness(1.2)}.lce-trust-actions .always{background:var(--lce-accent,#4d86c6);color:#fff}.lce-trust-actions .deny{background:#b04444;color:#fff}
@keyframes lce-trust-in{from{transform:translate(-50%,-130%);opacity:0}to{transform:translate(-50%,0);opacity:1}}@keyframes lce-trust-out{from{transform:translate(-50%,0);opacity:1}to{transform:translate(-50%,-130%);opacity:0}}
`;
    document.head.appendChild(style);
}

function askLocally(origin, content, persistent) {
    injectPromptStyle();
    return new Promise(resolve => {
        document.getElementById(ROOT_ID)?.remove();
        const root = document.createElement('section'); root.id = ROOT_ID; root.setAttribute('role', 'alertdialog');
        const message = document.createElement('div'); message.className = 'lce-trust-message'; message.textContent = promptText(origin, content);
        const actions = document.createElement('div'); actions.className = 'lce-trust-actions';
        const finish = action => {
            root.classList.add('closing');
            root.addEventListener('animationend', () => root.remove(), { once: true });
            setTimeout(() => root.remove(), 260); resolve(action);
        };
        const make = (label, action, cls = '') => {
            const button = document.createElement('button'); button.type = 'button'; button.className = cls;
            button.textContent = label; button.addEventListener('click', () => finish(action)); return button;
        };
        if (persistent) actions.appendChild(make(T('domain_always'), 'always', 'always'));
        actions.append(make(T('domain_allow'), 'submit'), make(T('domain_deny'), 'cancel', 'deny'));
        root.append(message, actions); document.body.appendChild(root);
    });
}

let promptChain = Promise.resolve();

/** LCE 信任詢問：PCM 有公開 modal 能力時委派，否則使用自己的頂部滑入提示。 */
export function requestOriginTrust(originValue, content, { persistent = true } = {}) {
    const origin = normalizeOrigin(originValue);
    if (!origin) return Promise.resolve('cancel');
    const task = async () => {
        const api = pcmModals();
        let action;
        try { action = api ? await askViaPcm(api, origin, content, persistent) : await askLocally(origin, content, persistent); }
        catch { action = await askLocally(origin, content, persistent); }
        if (action === 'always' && persistent) addTrustedOrigin(origin);
        else sessionCustomOrigins.set(origin, action === 'submit' ? 'allowed' : 'denied');
        return action;
    };
    const result = promptChain.then(task, task);
    promptChain = result.catch(() => {});
    return result;
}
