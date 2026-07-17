// ════════════════════════════════════════════════════════════════════════════
// Liko 共用 i18n 註冊處（window.Liko.I18N）
//
// ── 能共用什麼、不能共用什麼 ──
// 「字串」共用不了：LCE 的鍵（s_scrollMaxMessages、cat_theme…）不存在於 AEE 的
// 字庫，反之亦然。每個插件的字表本來就是自己的，換誰的引擎都得自己帶。
//
// 真正重複的是「現在是什麼語言」這件事：每個插件各自讀一次 TranslationLanguage、
// 各自寫一套語言碼正規化、各自輪詢語言有沒有被切換。那部分才是該共用的。
//
// 所以這個註冊處只做三件事：
//   1. 語言判斷與正規化（BC 的 TranslationLanguage → TW / CN / EN …）
//   2. 語言切換時通知所有插件
//   3. 讓每個插件把自己的字表掛在自己的 namespace 底下，共用上面那套語言判斷
//
// ── 先搶先贏 ──
// 誰先載入誰就建立它，後到的直接用現成的 —— 沿用 window.Liko.__Sys_Toast__ 的慣例。
// 版本對不上時各用各的，不強求（寧可多一套，也不要因為介面不合而整個壞掉）。
//
// 註：目前只有 LCE 實作這個介面。AEE 用的是 i18next + 每語系一個 JSON，
// 沒有對外暴露 i18n API，所以實務上現在都是 LCE 建立、LCE 自己用；
// 等哪天 AEE 也接上來，語言判斷就自動同一份了。
// ════════════════════════════════════════════════════════════════════════════

const API_VERSION = 1;
const LOG = '🐈‍⬛ [LCE]';
const POLL_MS = 2000;

/** BC 的語言碼 → 正規化語系碼。與 AEE 的 LANGUAGE_MAP 對齊，日後兩邊才接得起來。 */
const LANGUAGE_MAP = {
    EN: 'EN', DE: 'DE', FR: 'FR', RU: 'RU', CN: 'CN', TW: 'TW',
    UA: 'UA', UK: 'UA', UKR: 'UA', JA: 'JA', JP: 'JA', KO: 'KO', KR: 'KO',
    ZH: 'CN', 'ZH-CN': 'CN', 'ZH-HANS': 'CN', 'ZH-TW': 'TW', 'ZH-HANT': 'TW',
};

function normalize(code) {
    if (!code) return 'EN';
    return LANGUAGE_MAP[code] ?? LANGUAGE_MAP[String(code).toUpperCase()] ?? 'EN';
}

/** 讀 BC 目前的語言。登入前 TranslationLanguage 可能還沒設，退而讀 localStorage。 */
function detect() {
    const raw = (typeof TranslationLanguage !== 'undefined' && TranslationLanguage)
        || localStorage.getItem('BondageClubLanguage')
        || 'EN';
    return normalize(raw);
}

function createRegistry() {
    /** @type {Map<string, Record<string, Record<string, string>>>} namespace → { 語系碼: 字表 } */
    const namespaces = new Map();
    const listeners = new Set();
    let current = detect();

    // BC 沒有語言切換事件可掛，只能輪詢。兩秒一次、只比一個字串，成本可忽略。
    setInterval(() => {
        const next = detect();
        if (next === current) return;
        current = next;
        for (const cb of listeners) {
            try { cb(next); } catch (e) { console.warn(LOG, 'i18n 語言變更通知失敗:', e); }
        }
    }, POLL_MS);

    return Object.freeze({
        version: API_VERSION,

        /** 掛上某個插件的字表。tables 形如 { EN: {...}, TW: {...}, CN: {...} }。 */
        register(namespace, tables) {
            namespaces.set(namespace, tables);
        },

        /** 查字：找不到就退回 EN，再找不到就回鍵本身（讓漏翻一眼就看得出來）。 */
        t(namespace, key) {
            const tables = namespaces.get(namespace);
            if (!tables) return key;
            return tables[current]?.[key] ?? tables.EN?.[key] ?? key;
        },

        /** 目前語系（正規化後）。 */
        language: () => current,

        normalize,

        /** 語言切換時收通知。回傳解除註冊用的函式。 */
        onChange(cb) {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
    });
}

/**
 * 取得共用註冊處：已經有人建立就用他的，沒有就自己建一個。
 * @returns {object|null} 版本不相容時回傳 null，呼叫端請自己撐著（各用各的）。
 */
export function getSharedI18n() {
    window.Liko = window.Liko ?? {};
    const existing = window.Liko.I18N;

    if (existing) {
        if (existing.version === API_VERSION) return existing;
        console.warn(LOG, `已存在不相容的共用 i18n（v${existing.version}，我們是 v${API_VERSION}），改用自己的字庫`);
        return null;
    }

    window.Liko.I18N = createRegistry();
    return window.Liko.I18N;
}
