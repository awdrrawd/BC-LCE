import { getFeature } from './feature-settings.js';

/** 只有 WCE 完成啟動並公開即時設定讀取器時，才視為真的存在。 */
export function isWceLoaded() {
    return typeof globalThis.FBC_VERSION !== 'undefined'
        && typeof Player !== 'undefined' && !!Player?.FBC
        && typeof globalThis.fbcSettingValue === 'function';
}

/**
 * 讀 WCE 記憶體中的即時設定，而不是只讀可能過期的 ExtensionSettings 快照。
 * WCE 不存在、尚未完成啟動、設定不存在或讀取失敗時一律回 false，LCE 不會盲目避讓。
 */
export function isWceFeatureEnabled(key) {
    if (!isWceLoaded()) return false;
    try { return globalThis.fbcSettingValue(String(key)) === true; }
    catch { return false; }
}

/** LCE 自己已開啟，且已載入的 WCE 沒有開啟同類功能時，才由 LCE 處理。 */
export function shouldLceHandle(lceKey, wceKey = lceKey) {
    return !!getFeature(lceKey) && !isWceFeatureEnabled(wceKey);
}

export const WCE_OVERLAPS = Object.freeze({
    augmentChat: 'augmentChat',
    richOnlineProfile: 'richOnlineProfile',
    extendedWardrobe: 'extendedWardrobe',
    privateWardrobe: 'privateWardrobe',
    confirmWardrobeSave: 'confirmWardrobeSave',
    customContentDomainCheck: 'customContentDomainCheck',
    relogin: 'relogin',
    layeringHide: 'layeringHide',
    instantMessenger: 'instantMessenger',
    pendingMessages: 'pendingMessages',
    pastProfiles: 'pastProfiles',
    antiGarble: 'antiGarble',
    antiDeaf: 'antiDeaf',
    stutters: 'stutters',
    urlAsOoc: 'urlAsOoc',
    confirmLeave: 'confirmLeave',
    ghostNewUsers: 'ghostNewUsers',
    friendPresence: 'friendPresenceNotifications',
    itemAntiCheat: 'itemAntiCheat',
    autoStruggle: 'autoStruggle',
    lockpick: 'lockpick',
    allowLayeringWhileBound: 'allowLayeringWhileBound',
});
