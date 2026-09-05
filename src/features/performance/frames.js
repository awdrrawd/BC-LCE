import { createHook } from '../../core/hooks.js';
import { getFeature } from '../../core/feature-settings.js';
import { DEFAULT_FEATURE_SETTINGS, clampBar } from '../../core/settings-schema.js';
const hook = createHook('performance');
const bar = key => clampBar(DEFAULT_FEATURE_SETTINGS[key], getFeature(key));
// ───────────────────────── 低幀率 ─────────────────────────
//
// 不能直接用 BC 自己的 Player.GraphicsSettings.MaxFPS：那個值受伺服器驗證，
// 只接受 PreferenceGraphicsFrameLimit = [0, 10, 15, 30, 60]，填 35 會被打回預設。
// 也不再改寫 window.requestAnimationFrame —— 那會連帶節流所有用到 rAF 的
// 插件與 UI 動畫，不只是遊戲繪製。改成只攔 GameRun，跳幀方式與 BC 本身一致。

function shouldSkipFrame(timestamp) {
    if (!getFeature('lowFrameRateFpsEnabled')) return false;
    if (typeof TimerLastTime !== 'number' || TimerLastTime <= 0 || !(timestamp > 0)) return false;
    return TimerLastTime + 1000 / bar('lowFrameRateFps') > timestamp;
}

// ───────────────────────── FPS 顯示 ─────────────────────────
//
// BC 自己的 Player.GraphicsSettings.ShowFPS 只畫在左上角，而且那段是寫死在
// GameRun 裡的、沒有獨立函式可攔，所以位置要能選就只能自己畫一份。
//
// 但這樣一來，使用者若也開著 BC 原生的 ShowFPS，畫面上就會有兩個數字
// （BC 的固定在左上、我們的在使用者選的位置）。與其去改 Player.GraphicsSettings
// （那是會同步到伺服器的使用者設定，不該我們動手），不如把它那一次繪製攔下來 ——
// 認得出來是因為那行是寫死的：DrawTextFit(數字, 15, 12, 30, "white", "black")。
// 見 BC Game.js 的 GameRun。

/** BC 原生 FPS 那一行的固定簽名（x, y, width）。 */
const BC_FPS_CALL = { x: 15, y: 12, w: 30 };

/** 這一次 DrawTextFit 是不是 BC 自己畫 FPS？ */
function isBcNativeFps(args) {
    return args[1] === BC_FPS_CALL.x && args[2] === BC_FPS_CALL.y && args[3] === BC_FPS_CALL.w;
}

// 貼齊角落：靠 textAlign / textBaseline 對齊到邊，而不是硬猜座標 —— 這樣不管數字幾位數
// （"9" 或 "144"）都不會超出畫面或離角落忽遠忽近（呼應「留意文字大小」）。只留一點邊距免得
// 字貼死邊緣。canvas 邏輯座標是 2000×1000。
const FPS_MARGIN = 6;
const FPS_POS = {
    tl: { x: FPS_MARGIN,        y: FPS_MARGIN,        align: 'left',   base: 'top' },
    ml: { x: FPS_MARGIN,        y: 500,               align: 'left',   base: 'middle' },
    bl: { x: FPS_MARGIN,        y: 1000 - FPS_MARGIN, align: 'left',   base: 'bottom' },
    tc: { x: 1000,              y: FPS_MARGIN,        align: 'center', base: 'top' },
    bc: { x: 1000,              y: 1000 - FPS_MARGIN, align: 'center', base: 'bottom' },
    tr: { x: 2000 - FPS_MARGIN, y: FPS_MARGIN,        align: 'right',  base: 'top' },
    mr: { x: 2000 - FPS_MARGIN, y: 500,               align: 'right',  base: 'middle' },
    br: { x: 2000 - FPS_MARGIN, y: 1000 - FPS_MARGIN, align: 'right',  base: 'bottom' },
};

/**
 * BC 的預設字級是 36（DrawTextFit 畫完就把字型還原成 CommonGetFont(36)），
 * 依需求縮 4pt。
 */
const FPS_FONT_SIZE = 26;

let fpsLastTs = 0;
let fpsSmooth = 0;

function drawFps() {
    const pos = FPS_POS[getFeature('showFps')] ?? FPS_POS.tl;
    const ctx = window.MainCanvas?.getContext('2d');
    if (!ctx) return;

    const bakAlign = ctx.textAlign;
    const bakBase = ctx.textBaseline;
    const bakFont = ctx.font;
    // BC 的 DrawText 用的是當下 MainCanvas 的 textAlign / textBaseline（它自己不設），
    // 所以在這裡指定對齊方式，字就會精準貼到選定的角落／邊。
    ctx.textAlign = pos.align;
    ctx.textBaseline = pos.base;
    try {
        // 只畫數字，不加 "FPS"。
        // 用 DrawText 而非 DrawTextFit：後者會自己依寬度把字級從 36 一路縮到塞得下為止，
        // 字級等於被寬度綁架（"144" 會比 "60" 小一號）。這裡要的是固定字級，
        // 所以自己設好字型再畫 —— DrawText 用的就是當下的 MainCanvas.font。
        if (typeof CommonGetFont === 'function') ctx.font = CommonGetFont(FPS_FONT_SIZE);
        DrawText(String(Math.round(fpsSmooth)), pos.x, pos.y, 'White', 'Black');
    } finally {
        ctx.font = bakFont;
        ctx.textAlign = bakAlign;
        ctx.textBaseline = bakBase;
    }
}

let installed = false;
export function installFramePerformance() {
    if (installed) return;
    installed = true;
    // 低幀率：跳幀的作法與 BC GameRun 自己的上限判斷一致 —— 重掛下一幀後直接返回。
    hook('GameRun', 0, (args, next) => {
        if (!shouldSkipFrame(args[0])) return next(args);
        window.GameAnimationFrameId = requestAnimationFrame(window.GameRun);
        return undefined;
    });

    // 我們的 FPS 開著時，把 BC 原生那一份擋掉，畫面上永遠只有一個數字、
    // 而且在使用者選的位置。關掉我們的就原樣放行，BC 照舊畫它的左上角。
    hook('DrawTextFit', 0, (args, next) => {
        if (getFeature('showFpsEnabled') && isBcNativeFps(args)) return undefined;
        return next(args);
    });

    // FPS：DrawProcess 每畫一幀跑一次，跳掉的幀不會進來，所以量到的就是實際幀率。
    hook('DrawProcess', 0, (args, next) => {
        const ret = next(args);
        try {
            if (!getFeature('showFpsEnabled')) { fpsLastTs = 0; fpsSmooth = 0; return ret; }
            const ts = typeof args[0] === 'number' ? args[0] : performance.now();
            if (fpsLastTs > 0 && ts > fpsLastTs) {
                const inst = 1000 / (ts - fpsLastTs);
                // 指數平滑：瞬時值每幀都在跳，讀不出來
                fpsSmooth = fpsSmooth > 0 ? fpsSmooth * 0.9 + inst * 0.1 : inst;
            }
            fpsLastTs = ts;
            if (fpsSmooth > 0) drawFps();
        } catch { /* 畫不出來就算了，不能拖累繪製 */ }
        return ret;
    });

}
