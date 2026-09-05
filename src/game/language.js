// ───────────────────────── 遊戲語言（misc）─────────────────────────
// BC 只在登入頁提供語言選單，登入後就沒得改（只能刷新頁面）。這裡把它搬進設定頁，
// 語言清單直接取自 BC 的 TranslationDictionary（與登入頁的選單同一份來源）。
//
// TranslationSwitchLanguage(code) 本身只改 TranslationLanguage + localStorage、不重載文字，
// 所以要沿用登入頁（loginpage/login-ui.js）的重載手續：TextLoad / ActivityDictionaryLoad /
// AssetLoadDescription。這段只碰 BC 全域，不 import 任何功能模組（避免與 feature-settings 循環相依）。

// 語言清單快取一次（BC 字典載入後就固定）。字典還沒好時回後備清單、且不快取，等下次載入。
let _langCache = null;
export function gameLanguages() {
    if (_langCache) return _langCache;
    try {
        if (typeof TranslationDictionary !== 'undefined' && Array.isArray(TranslationDictionary) && TranslationDictionary.length) {
            const codes = [], labels = [];
            for (const l of TranslationDictionary) {
                if (!l?.LanguageCode) continue;
                codes.push(l.LanguageCode);
                labels.push((l.Icon ? l.Icon + ' ' : '') + (l.LanguageName || l.EnglishName || l.LanguageCode));
            }
            if (codes.length) { _langCache = { codes, labels }; return _langCache; }
        }
    } catch { /* ignore */ }
    return { codes: ['EN'], labels: ['English'] };   // 後備（不快取，等字典載入）
}

/** BC 目前語言碼（讀不到就退回 localStorage / EN）。 */
export function currentGameLanguage() {
    return (typeof TranslationLanguage !== 'undefined' && TranslationLanguage)
        || localStorage.getItem('BondageClubLanguage') || 'EN';
}

/**
 * 切換遊戲語言。
 *   init  → 只把顯示值對齊「實際語言」，不觸發切換（避免每次登入強制覆寫使用者當下的語言）。
 *   非 init → 真的切語言並重載文字/活動字典/物品說明（同登入頁的手續）。
 * gameLanguage 只是 BC 語言狀態的鏡射，BC 自己把選擇存進 localStorage，這裡不另外持久化。
 */
export function switchGameLanguage(code, init, s) {
    try {
        const current = currentGameLanguage();
        if (init) {
            if (s && code !== current) s.gameLanguage = current;   // 顯示值對齊實際語言
            return;
        }
        if (!code || code === current) return;
        if (typeof TranslationSwitchLanguage !== 'function') return;
        TranslationSwitchLanguage(code);
        if (typeof TextLoad === 'function')               TextLoad();
        if (typeof ActivityDictionaryLoad === 'function') ActivityDictionaryLoad();
        if (typeof AssetLoadDescription === 'function')   AssetLoadDescription('Female3DCG');
        console.debug('🐈‍⬛ [LCE] setting changed: gameLanguage =', code);
    } catch (e) { console.warn('🐈‍⬛ [LCE] 切換遊戲語言失敗:', e); }
}

