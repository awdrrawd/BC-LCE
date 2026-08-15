// Shared hidden-arousal coordinator used by LCE, HHA, and AEE.

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';
const REGISTRY_KEY = '__hotfix_HiddenArousal';

function shouldHide() {
    if (!getFeature('hideArousalMeter')) return false;
    try {
        const s = CurrentScreen;
        if (s === 'Appearance' || s === 'InformationSheet') return true;
        return s === 'ChatRoom'
            && typeof CurrentCharacter !== 'undefined'
            && CurrentCharacter !== null;
    } catch { return false; }
}

function getRegistry() {
    window.Liko = window.Liko ?? {};
    const current = window.Liko[REGISTRY_KEY];
    if (current?.version === 1 && current.providers) return current;
    return window.Liko[REGISTRY_KEY] = { version: 1, installed: false, providers: {} };
}

let installed = false;

export function installHiddenArousal() {
    if (installed) return;
    installed = true;

    const registry = getRegistry();
    registry.providers.LCE = shouldHide;
    if (registry.installed) return;

    try {
        modApi.hookFunction('DrawArousalMeter', 10, (args, next) => {
            for (const provider of Object.values(registry.providers)) {
                try { if (provider()) return; } catch { /* ignore an unloading provider */ }
            }
            return next(args);
        });
        registry.installed = true;
    } catch (e) {
        console.warn(LOG, 'Shared hidden-arousal hook unavailable:', e?.message ?? e);
    }
}
