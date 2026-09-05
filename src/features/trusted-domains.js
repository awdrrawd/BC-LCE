import { T } from '../core/i18n.js';
import { openModalAsync } from '../core/modal-service.js';

const STORAGE_KEY = 'lce_trusted_image_origins';

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

/** Permanent grants apply to images only; other content retains session-only consent. */
export function getTrustDecision(value, { persistent = true } = {}) {
    const origin = normalizeOrigin(value);
    if (!origin) return 'denied';
    if (persistent && isOriginTrusted(origin)) return 'allowed';
    return sessionCustomOrigins.get(origin) ?? 'unknown';
}

export function isTrustedOrigin(value, options) {
    return getTrustDecision(value, options) === 'allowed';
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

function promptText(origin, content) {
    return T('domain_prompt').replace('{content}', content).replace('{origin}', origin).replace('{trusted}', '');
}

let promptChain = Promise.resolve();

/** LCE 信任詢問：PCM 有公開 modal 能力時委派，否則使用自己的頂部滑入提示。 */
export function requestOriginTrust(originValue, content, { persistent = true } = {}) {
    const origin = normalizeOrigin(originValue);
    if (!origin) return Promise.resolve('cancel');
    const task = async () => {
        const buttons = persistent
            ? { always: T('domain_always'), submit: T('domain_allow'), cancel: T('domain_deny') }
            : { submit: T('domain_allow'), cancel: T('domain_deny') };
        const [action] = await openModalAsync({ prompt: promptText(origin, content), buttons });
        if (action === 'always' && persistent) addTrustedOrigin(origin);
        else sessionCustomOrigins.set(origin, action === 'submit' ? 'allowed' : 'denied');
        return action;
    };
    const result = promptChain.then(task, task);
    promptChain = result.catch(() => {});
    return result;
}
