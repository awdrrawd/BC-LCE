// LCE 對共用 BC i18n 引擎的薄轉接層。
// 引擎原始碼以 liko-Plugin-Repository/Plugins/expand/BC_i18n.js 為唯一來源；
// 本專案內嵌同步副本，確保沒有 PCM / CDN 時仍能獨立運作。
import './i18n-engine.js';

const API_VERSION = '2.1.0';
const LOG = '🐈‍⬛ [LCE]';

function transposeTables(tables) {
    const strings = Object.create(null);
    for (const [lang, table] of Object.entries(tables || {})) {
        if (!table || typeof table !== 'object') continue;
        for (const [key, value] of Object.entries(table)) {
            strings[key] = strings[key] || Object.create(null);
            strings[key][lang] = value;
        }
    }
    return strings;
}

/**
 * 保留 LCE 原本使用的 registry 介面，但所有行為都委派給 __Sys_i18n__。
 * @returns {object|null} 共用引擎不可用時回傳 null，呼叫端使用自己的 EN 後備。
 */
export function getSharedI18n() {
    const engine = window.Liko?.__Sys_i18n__;
    if (!engine?.register || !engine?.t) return null;
    if (engine.version !== API_VERSION) {
        console.warn(LOG, `共用 i18n 版本為 v${engine.version || 'unknown'}，預期 v${API_VERSION}；將使用相容 API`);
    }

    return Object.freeze({
        version: engine.version,
        register(namespace, tables) {
            engine.register(namespace, transposeTables(tables));
        },
        t(namespace, key) {
            return engine.t(namespace, key);
        },
        language() {
            return engine.detectLang?.() || 'EN';
        },
        normalize(code) {
            return engine.normalizeLang?.(code) || 'EN';
        },
        onChange(callback) {
            return engine.onChange?.(callback) || (() => {});
        },
    });
}
