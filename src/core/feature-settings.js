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

import { DEFAULT_FEATURE_SETTINGS, defaultValues, globalKeys, clampBar } from './settings-schema.js';
import { FEATURE_SETTINGS_VERSION, LCE_EXT_KEY, SETTINGS_KEY, SETTING_CHANGED_EVENT } from './constants.js';

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

/** 輪詢等待條件成立。tries = Infinity 表示不設上限（等到成立為止）。 */
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
 * 舊的布林開關 → 新的「開關 + 參數」兩個鍵。
 *
 * reduceTextureQuality / lowFrameRate 原本各是一個布林；改版後拆成
 * textureQuality(+Enabled) 與 lowFrameRateFps(+Enabled)。不接手的話，
 * 下面的未知鍵清理會把舊鍵默默刪掉、再從預設補一個 false ——
 * 使用者本來開著的低幀率模式會在升級後無聲無息地關掉。
 *
 * 必須在「補齊缺漏的預設」之前呼叫：預設一補上去，新鍵就已經存在，
 * 這裡的 `in` 判斷就再也接不到手了。
 */
const RENAMED_TOGGLES = {
    reduceTextureQuality: 'textureQualityEnabled',
    lowFrameRate: 'lowFrameRateFpsEnabled',
};

function migrateRenamedToggles(settings) {
    for (const [oldKey, newKey] of Object.entries(RENAMED_TOGGLES)) {
        if (typeof settings[oldKey] !== 'boolean' || newKey in settings) continue;
        settings[newKey] = settings[oldKey];
        console.info(LOG, `設定已遷移：${oldKey} → ${newKey} =`, settings[oldKey]);
    }
}

/**
 * 等 Player.AccountName 就緒後從伺服器載入設定，補齊缺漏預設、剔除未知鍵。
 * 回傳完整設定物件。
 */
export async function loadFeatureSettings() {
    // 不設上限，等到登入為止。
    //
    // 原本是等 60 秒就放棄、改用一整份預設值 —— 但使用者在登入頁停留超過一分鐘
    // 太常見了（泡杯咖啡、掛著等朋友、慢慢挑帳號）。而放棄之後 main.js 會照常
    // 接著跑 postFeatureSettings()，它結尾的 saveFeatureSettings() 會把那份預設值
    // 寫回全域 localStorage —— 使用者調好的主題與 UI 設定就這樣被清成預設值。
    // （這也是「共用設定常常失效」的另一個來源。）
    //
    // 沒登入本來就沒有「該載入的每帳號設定」，等下去才是對的：條件一成立就往下跑，
    // 使用者永遠不登入的話這個 Promise 就永遠不 resolve，後面那些功能也本來就不該裝。
    // 用 250ms 疏探（而非預設 100ms）：登入靠使用者操作、可能停留數分鐘，降低輪詢頻率省資源，
    // 而登入後功能安裝本來就緊接著這裡，多出的 <150ms 延遲無感。
    await waitFor(() => !!(typeof Player !== 'undefined' && Player?.AccountName), Infinity, 250);

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

    migrateRenamedToggles(settings);

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
    // bar 的值一律正規化成合法數字：舊版存的是 select 的字串（'50'），
    // 直接拿去算比例會得到 NaN，滑桿就畫不出來也拖不動。
    for (const [k, def] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
        if (def.type === 'bar') settings[k] = clampBar(def, settings[k]);
    }
    settings.version = FEATURE_SETTINGS_VERSION;

    fSettings = settings;
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

/**
 * 程式化設定單一值：更新、觸發 sideEffects、發出變更事件、存檔。
 *
 * 事件不能只在設定頁發（settings-page.js 的 fireSideEffect）—— 那樣從登入頁的
 * 控制項、指令或公開 API（window.Liko.LCE.setFeature）改值時，所有靠
 * lce-setting-changed 即時反應的功能（介面配色、聊天容量、貼圖畫質…）全都收不到，
 * 設定看起來就像沒生效。這裡是程式化改值的唯一出入口，事件就該在這裡發。
 */
export function setFeature(key, value) {
    // withToggle / withSound 產生的 `<key>Enabled` / `<key>Sound` 是合法的設定鍵，
    // 但它們是動態衍生的、不在 schema 物件裡（設定頁是直接寫 fSettings）。
    // 不放行的話，從公開 API 或指令改這些開關會靜靜失敗、什麼事都不會發生。
    // 副作用掛在「本尊」那一項上，所以要拿本尊的 def 來跑（同設定頁的 fireSideEffect）。
    const owner = DEFAULT_FEATURE_SETTINGS[key] ? key : key.replace(/(Enabled|Sound)$/, '');
    const def = DEFAULT_FEATURE_SETTINGS[owner];
    if (!def || def.type === 'action') return;
    if (owner !== key && !def.withToggle && !def.withSound) return;   // 不是真的衍生鍵

    fSettings[key] = value;
    try { def.sideEffects?.(fSettings[owner], false, fSettings); }
    catch (e) { console.warn(LOG, 'sideEffects 失敗:', key, e); }
    try { window.dispatchEvent(new CustomEvent(SETTING_CHANGED_EVENT, { detail: { key, value } })); }
    catch { /* ignore */ }
    saveFeatureSettings();
}
