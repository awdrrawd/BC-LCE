// BC 表情設定適配；初始化不得清除舊存檔保留的附屬功能。
export function applyAnimationEngineSetting(newValue, init, s) {
    // 接管後 BC 原生的慾望表情會與引擎互搶同一張臉
    if (newValue && typeof Player !== 'undefined' && Player?.ArousalSettings) Player.ArousalSettings.AffectExpression = false;
    // 使用者「手動」關掉總開關時，一併關掉附屬功能。
    // 絕不可在 init 時做：postFeatureSettings 每次載入都會用當下值跑一次
    // sideEffects 並存檔，而本開關是後加的、預設 false —— 舊存檔的
    // activityExpressions=true 會在每次登入被靜靜清成 false，表情引擎形同永久停用。
    // （附屬功能留著 true 也無害：disabled 會擋 UI，engineOn 會擋執行。）
    if (!init && !newValue) {
        s.autoArousalExpression = false;
        s.activityExpressions = false;
    }
    if (!init) console.debug('🐈‍⬛ [LCE] setting changed: animationEngine =', newValue);
}

export function grantWardrobe() {
    try {
        if (typeof LogQuery === 'function' && LogQuery('Wardrobe', 'PrivateRoom')) return;
        if (typeof LogAdd !== 'function') throw new Error('LogAdd unavailable');
        LogAdd('Wardrobe', 'PrivateRoom');
    } catch (e) { console.warn('🐈‍⬛ [LCE] grantWardrobe 失敗:', e); return false; }
}
