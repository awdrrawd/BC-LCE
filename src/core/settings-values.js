import { DEFAULT_FEATURE_SETTINGS, clampBar, gameLanguages } from './settings-schema.js';

export function resolveSettingKey(key) {
    if (typeof key !== 'string') return null;
    if (Object.hasOwn(DEFAULT_FEATURE_SETTINGS, key)) {
        const def = DEFAULT_FEATURE_SETTINGS[key];
        return def.type === 'action' ? null : { key, ownerKey: key, def };
    }
    const match = /^(.*)(Enabled|Sound)$/.exec(key);
    if (!match || !Object.hasOwn(DEFAULT_FEATURE_SETTINGS, match[1])) return null;
    const def = DEFAULT_FEATURE_SETTINGS[match[1]];
    if (!(match[2] === 'Enabled' ? def.withToggle : def.withSound)) return null;
    return { key, ownerKey: match[1], def, derived: match[2] };
}

/** Invalid writes are rejected; old numeric bar strings remain supported. */
export function normalizeSettingValue(setting, value) {
    const { def, derived } = setting;
    if (derived || def.type === 'checkbox') {
        if (typeof value !== 'boolean') throw new TypeError('Expected a boolean');
    } else if (def.type === 'bar') {
        if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value))) {
            throw new TypeError('Expected a finite number');
        }
        return clampBar(def, value);
    } else if (def.type === 'select') {
        if (!def.options.includes(value)) throw new TypeError('Unknown option');
    } else if (def.type === 'input') {
        if (typeof value !== 'string') throw new TypeError('Expected text');
        if (def.subtype === 'color') {
            value = value.trim();
            if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
                && !(typeof CSS !== 'undefined' && CSS.supports('color', value))) throw new TypeError('Invalid color');
        }
        if (def.subtype === 'language' && !gameLanguages().codes.includes(value)) throw new TypeError('Unknown language');
    } else if (def.type === 'hidden') {
        if (!Array.isArray(value)) throw new TypeError('Expected an array');
        return structuredClone(value);
    }
    return value;
}

/** One callback per transaction, with both actual and owning keys available. */
export function settingChangeAffects(event, keys) {
    const detail = event.detail;
    if (!detail) return false;
    const changes = detail.changes || [detail];
    if (changes[0]?.key !== detail.key) return false;
    return changes.some(change => keys.includes(change.key) || keys.includes(change.ownerKey));
}
