// ════════════════════════════════════════════════════════════════════════════
// ECHS（Erotic Chat Hypnosis Suite / HypnosisAddon）設定頁的主題相容層
//
// 為什麼需要它：
//  1. 左側分頁按鈕：ECHS 以 DrawButton(..., "#d8d8d8") 畫未選中的分頁。#d8d8d8 不在 KNOWN
//     對照表內（不在「檢測區」），底色不會被換成主題色，但按鈕文字會被 DrawButton hook 換成
//     主題文字色 #CCCCCC → 淺灰底配淺灰字，幾乎看不見。→ 在 ECHS 畫面把 #d8d8d8 視同一般按鈕色。
//  2. 右側內容：ECHS 的標籤/說明/標題多半不走 DrawText 家族，而是自己呼叫
//     MainCanvas.fillText（drawLeftText / drawLeftTextFit / drawLeftTextWrap…）寫黑字或灰字，
//     DrawText / DrawTextFit 的 hook 完全碰不到 → 深色主題下黑字落在深色底上。
//     → 做法同 BC-translation-patch 的 echsCanvas.js：只在 ECHS 設定頁開著時，包住
//       MainCanvas.fillText，把「接近黑/灰」的 fillStyle 換成主題文字色。
//       有顏色的字（紅色警告、琥珀色橫幅上的棕字…）與白字一律不動。
// ════════════════════════════════════════════════════════════════════════════

/** BC 把這些宣告成頂層 `let`：是全域詞法綁定、不是 window 屬性，只能用裸識別字經 typeof 讀。 */
const lexical = {
    mainCanvas: () => typeof MainCanvas !== 'undefined' ? MainCanvas : undefined,
    current: () => typeof PreferenceExtensionsCurrent !== 'undefined' ? PreferenceExtensionsCurrent : undefined,
    settings: () => typeof PreferenceExtensionsSettings !== 'undefined' ? PreferenceExtensionsSettings : undefined,
};

const ECHS_ID = 'HypnosisAddon';

const is2d = ctx => !!ctx && typeof ctx.fillText === 'function' && typeof ctx.measureText === 'function';

/** 遊戲的 2D context（env 優先，方便測試）。 */
export function getMainCanvas(env = globalThis) {
    for (const candidate of [env.MainCanvas, lexical.mainCanvas()]) if (is2d(candidate)) return candidate;
    return undefined;
}

/** 目前是否正開著 ECHS 自己的「偏好設定 > 擴充功能」畫面（含其說明頁、設定精靈）。 */
export function isEchsScreen(env = globalThis) {
    if (env.CurrentScreen !== 'Preference') return false;
    const current = env.PreferenceExtensionsCurrent ?? lexical.current();
    const settings = env.PreferenceExtensionsSettings ?? lexical.settings();
    return !!current && current === settings?.[ECHS_ID];
}

/**
 * ECHS 專用的按鈕色 → 語意色（只在 ECHS 畫面才查，不影響其他畫面）。
 * 值為 plainColors 的欄位名，與 theme/index.js 的 KNOWN 同一套用法。
 */
export const ECHS_KNOWN = new Map([
    ['#d8d8d8', 'element'], // 左側未選中的分頁按鈕（panel.ts drawTabsAndPanel）
]);

/**
 * 文字顏色換算：
 *  - 近黑的中性色（#000 / #222 / #333…）→ 主題文字色（要求的 #CCCCCC）
 *  - 中灰的中性色（#555 / #777 / Gray）→ 主題「停用」文字色，保留 ECHS 的次要文字層次
 *  - 其他（白、有色彩的字）→ null，不動
 * @returns {string|null} 要改用的顏色；不需改時 null
 */
export function mapEchsTextColor(hex, { text, textDisabled }) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
    if (!m) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) return null; // 有色彩：紅色警告、棕色橫幅字等
    const v = (r + g + b) / 3;
    if (v <= 0x33) return text;
    if (v <= 0x99) return textDisabled;
    return null;
}

/**
 * @param {{ isActive: () => boolean, colors: () => {text: string, textDisabled: string},
 *           toHex: (c: string) => string|null, env?: object }} options
 * @returns {{ ensure(): void, dispose(): void }}
 */
export function createEchsCanvasTheme({ isActive, colors, toHex, env = globalThis }) {
    let patched = null, restore = null;

    function install(ctx) {
        const fill = ctx.fillText;
        const wrapper = function (text, x, y, ...rest) {
            if (typeof this?.fillStyle === 'string' && isActive() && isEchsScreen(env)) {
                const to = mapEchsTextColor(toHex(this.fillStyle), colors());
                if (to) {
                    const previous = this.fillStyle;
                    this.fillStyle = to;
                    try { return fill.call(this, text, x, y, ...rest); }
                    finally { this.fillStyle = previous; }
                }
            }
            return fill.call(this, text, x, y, ...rest);
        };
        ctx.fillText = wrapper;
        return () => {
            // 只有最上層還是自己時才移除；若別的模組（翻譯補丁）疊在上面就不去動它。
            if (ctx.fillText === wrapper) {
                if (fill === Object.getPrototypeOf(ctx)?.fillText) delete ctx.fillText;
                else ctx.fillText = fill;
            }
        };
    }

    return {
        /** 便宜：每幀可呼叫；只有 MainCanvas 第一次出現或被遊戲換掉時才真的包。 */
        ensure() {
            const ctx = getMainCanvas(env);
            if (!ctx || ctx === patched) return;
            restore?.();
            patched = ctx;
            restore = install(ctx);
        },
        dispose() { restore?.(); patched = restore = null; },
    };
}
