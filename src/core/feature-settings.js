// ════════════════════════════════════════════════════════════════════════════
// 功能設定儲存層（仿 WCE src/util/settings.ts）
//
// 設定依分類分流到兩個地方：
//   ui / theme  →  全域 localStorage（lce_settings.features）：不分帳號共用，
//                  且登入頁在還沒有 Player 時就讀得到。
//   其他        →  Player.ExtensionSettings.LCE（LZString 壓縮）：每帳號 + 伺服器同步。
//
// 之所以不把全部都塞 localStorage：那是整個網域共用的空間，被其他插件塞爆時會丟
// QuotaExceededError。外觀類設定量小、又非讀不可，才特例放進去。
// ════════════════════════════════════════════════════════════════════════════

import { DEFAULT_FEATURE_SETTINGS, defaultValues, globalKeys } from './settings-schema.js';
import { FEATURE_SETTINGS_VERSION, LCE_EXT_KEY, SETTINGS_KEY } from './constants.js';

// 載入後即為完整設定物件；載入前為空物件（getFeature 會 fallback 到預設）。
export let fSettings = {};

const LOG = '🐈‍⬛ [LCE]';


function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function decompress(b) {
    try { return (typeof LZString !== 'undefined' && b) ? LZString.decompressFromBase64(b) : null; }
    catch { return null; }
}

// ───────────────────────── 全域設定（ui / theme）─────────────────────────
// 寄生在登入頁既有的 lce_settings 底下開一個 features 子物件，不另開 key，
// 這樣登入頁與遊戲內共用同一份、也只佔一格 localStorage。

/** 讀出整包 lce_settings（登入頁設定 + features 子物件）。 */
function readGlobalRoot() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
}

/** 讀取全域功能設定（ui / theme）。登入前也能呼叫。 */
export function loadGlobalFeatures() {
    const root = readGlobalRoot();
    return (root.features && typeof root.features === 'object') ? root.features : {};
}

/** 把全域功能設定寫回 localStorage，保留 lce_settings 的其他欄位不動。 */
function saveGlobalFeatures(obj) {
    try {
        const root = readGlobalRoot();
        root.features = obj;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(root));
    } catch (e) {
        // 配額爆掉不能讓整個存檔流程中斷，DB 那半邊還是要存成功
        console.warn(LOG, '全域設定寫入失敗（ui/theme 這次不會保存）:', e);
    }
}

/** 輪詢等待條件成立（預設最多 ~60 秒）。 */
function waitFor(cond, tries = 600, intervalMs = 100) {
    return new Promise((resolve) => {
        (function loop(n) {
            let ok = false;
            try { ok = !!cond(); } catch { ok = false; }
            if (ok) return resolve(true);
            if (n <= 0) return resolve(false);
            setTimeout(() => loop(n - 1), intervalMs);
        })(tries);
    });
}

/**
 * 等 Player.AccountName 就緒後從伺服器載入設定，補齊缺漏預設、剔除未知鍵。
 * 回傳完整設定物件。
 */
export async function loadFeatureSettings() {
    await waitFor(() => !!(typeof Player !== 'undefined' && Player?.AccountName));
    if (typeof Player === 'undefined' || !Player?.AccountName) {
        console.warn(LOG, '等待帳號逾時，功能設定改用預設值');
        fSettings = { ...defaultValues(), version: FEATURE_SETTINGS_VERSION };
        return fSettings;
    }

    // 每帳號的部分從伺服器讀（DB 是這半邊的唯一正本）
    const online = parseJSON(decompress(Player.ExtensionSettings?.[LCE_EXT_KEY] || ''));
    let settings = (online && typeof online === 'object') ? online : {};

    // 清掉舊版本留在本機的快取，把 localStorage 空間還給瀏覽器
    try { localStorage.removeItem(`lce.settings.${Player.AccountName}`); } catch { /* ignore */ }

    // ui / theme 改存全域後，舊版使用者的值還留在 DB 裡。
    // 全域還沒有該鍵、但 DB 有 → 搬過去，否則升級會把人家調好的主題重置掉。
    const gKeys = globalKeys();
    const globals = loadGlobalFeatures();
    let migrated = 0;
    for (const k of gKeys) {
        if (!(k in globals) && k in settings) { globals[k] = settings[k]; migrated++; }
    }
    if (migrated) {
        saveGlobalFeatures(globals);
        console.info(LOG, `已將 ${migrated} 項 UI/主題設定從帳號搬到全域共用`);
    }

    // 全域鍵蓋掉 DB 的值：同一個鍵兩邊都有時，全域才是正本
    for (const k of gKeys) {
        if (k in globals) settings[k] = globals[k];
    }

    // 補齊缺漏的預設
    const defs = defaultValues();
    for (const k of Object.keys(defs)) {
        if (!(k in settings)) settings[k] = defs[k];
    }
    // 剔除已不存在的舊設定鍵。
    // 白名單必須用 defaultValues()（而非 DEFAULT_FEATURE_SETTINGS）—— withToggle 的開關鍵
    // （如 friendOnlineNotifyEnabled）是動態產生的，不在 schema 物件裡；
    // 若拿 schema 當白名單，這些鍵會在每次載入時被誤刪，導致開關永遠存不起來。
    for (const k of Object.keys(settings)) {
        if (k !== 'version' && !(k in defs)) delete settings[k];
    }
    settings.version = FEATURE_SETTINGS_VERSION;

    fSettings = settings;
    console.debug(LOG, '功能設定已載入', fSettings);
    return fSettings;
}

/**
 * 登入前用的輕量載入：只取全域的 ui / theme，補齊預設。
 * 登入頁（LoginLoad）拿不到 Player，只能用這個。
 */
export function loadGlobalFeatureSettings() {
    const defs = defaultValues();
    const globals = loadGlobalFeatures();
    const out = {};
    for (const k of globalKeys()) out[k] = (k in globals) ? globals[k] : defs[k];
    return out;
}

/**
 * 舊版登入頁用 lce_settings.enhance 當總開關（只有橫向版面）。
 * 現在改成 horizontalLogin / verticalLogin 一對，所以把舊值接過來：
 * 之前關掉 enhance 的人，升級後不該突然又冒出 LCE 登入頁。
 * 只做一次，做完把舊鍵刪掉。
 */
function migrateEnhance() {
    try {
        const root = readGlobalRoot();
        if (!('enhance' in root)) return;
        const features = (root.features && typeof root.features === 'object') ? root.features : {};
        if (!('horizontalLogin' in features)) features.horizontalLogin = !!root.enhance;
        delete root.enhance;
        root.features = features;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(root));
        console.info(LOG, '登入介面開關已遷移：enhance →', features.horizontalLogin ? 'horizontalLogin(開)' : 'horizontalLogin(關)');
    } catch (e) { console.warn(LOG, 'enhance 遷移失敗:', e); }
}

/**
 * 在登入前先把全域設定灌進 fSettings，讓 getFeature('verticalLogin') 之類
 * 在登入頁就讀得到。之後 loadFeatureSettings() 會再補上每帳號的部分。
 * 必須同步、不等 Player —— 登入頁等不到。
 */
export function initGlobalFeatures() {
    migrateEnhance();
    Object.assign(fSettings, loadGlobalFeatureSettings());
    return fSettings;
}

/**
 * 儲存設定。ui / theme 寫全域 localStorage，其餘寫 Player.ExtensionSettings。
 *
 * 兩邊各自 try/catch：全域寫失敗（配額爆掉）不能連帶讓 DB 那半邊也沒存到 ——
 * 這正是先前 QuotaExceededError 把整個存檔流程炸掉的原因。
 *
 * ServerPlayerExtensionSettingsSync 只會送出 { "ExtensionSettings.LCE": value } 這一個鍵，
 * 不會把整包 ExtensionSettings 重送。
 */
export function saveFeatureSettings() {
    const gKeys = globalKeys();

    // ── 全域（ui / theme）──
    const globals = {};
    for (const k of gKeys) if (k in fSettings) globals[k] = fSettings[k];
    saveGlobalFeatures(globals);

    // ── 每帳號（其餘）──
    if (typeof Player === 'undefined' || !Player?.AccountName) return;
    try {
        if (typeof LZString === 'undefined' || !Player.ExtensionSettings) return;
        // 全域鍵不再寫進 DB，避免同一份資料兩邊各存一份、日後不知道誰是正本
        const perAccount = {};
        for (const [k, v] of Object.entries(fSettings)) {
            if (!gKeys.has(k)) perAccount[k] = v;
        }
        Player.ExtensionSettings[LCE_EXT_KEY] = LZString.compressToBase64(JSON.stringify(perAccount));
        if (typeof ServerPlayerExtensionSettingsSync === 'function') {
            ServerPlayerExtensionSettingsSync(LCE_EXT_KEY);
        }
    } catch (e) {
        console.warn(LOG, '設定同步到伺服器失敗:', e);
    }
}

/** 載入後執行一次所有 sideEffects（init=true），套用設定初始狀態。 */
export function postFeatureSettings() {
    for (const [key, def] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
        if (def.type === 'action' || typeof def.sideEffects !== 'function') continue;
        try { def.sideEffects(fSettings[key], true, fSettings); }
        catch (e) { console.warn(LOG, 'sideEffects 失敗:', key, e); }
    }
    saveFeatureSettings();
}

/** 讀取單一設定值；未載入時 fallback 到 schema 預設。 */
export function getFeature(key) {
    if (key in fSettings) return fSettings[key];
    return DEFAULT_FEATURE_SETTINGS[key]?.value;
}

/** 程式化設定單一值：更新、觸發 sideEffects、存檔。 */
export function setFeature(key, value) {
    const def = DEFAULT_FEATURE_SETTINGS[key];
    if (!def || def.type === 'action') return;
    fSettings[key] = value;
    try { def.sideEffects?.(value, false, fSettings); }
    catch (e) { console.warn(LOG, 'sideEffects 失敗:', key, e); }
    saveFeatureSettings();
}
