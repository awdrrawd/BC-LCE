import { SETTINGS_KEY } from './constants.js';

/** Shared localStorage root, independent of login UI state. */
export function readRoot() {
    try {
        const root = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return root && typeof root === 'object' && !Array.isArray(root) ? root : {};
    } catch { return {}; }
}
