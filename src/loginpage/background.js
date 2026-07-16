// ════════════════════════════════════════════════════════════════════════════
// 登入背景
// 使用專案 Images/ 資料夾內的自訂圖片（BG-01.jpg…）。Vite 於建置時把圖片輸出成
// 獨立的 hash 檔（可被瀏覽器快取），URL 以 import.meta.url 相對 bundle 解析，跨來源
// 載入也正確。在 stage 最底層鋪一張滿版背景圖蓋住整個 canvas —— 同時遮住 BC 的登入
// 角色/感謝名單，以及 WCE 畫在 canvas 上的存檔按鈕（點4、點5）。
// 新增圖片只要丟進 Images/ 依檔名排序即可自動納入（無需改程式，重新 build 即可）。
// ════════════════════════════════════════════════════════════════════════════

import { S } from '../core/state.js';

// 建置時把 Images/*.{jpg,jpeg,png,webp} 全部收進來（eager，取 default = 輸出檔的 URL）
// 路徑相對本檔（src/loginpage/）→ 專案根的 Images/ 需回上兩層。
const _modules = import.meta.glob('../../Images/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });

/** @type {{ name: string, url: string }[]} 依檔名排序的自訂背景清單 */
export const CUSTOM_BACKGROUNDS = Object.keys(_modules)
    .sort()
    .map(path => ({
        name: path.split('/').pop().replace(/\.[^.]+$/, ''),
        url:  _modules[path],
    }));

/** @returns {string[]} 可選背景名稱清單（供設定下拉使用） */
export function getBackgroundList() {
    return CUSTOM_BACKGROUNDS.map(b => b.name);
}

/** @returns {{name:string,url:string}|null} 依設定挑選背景（隨機模式每次重抽） */
export function pickBackground() {
    if (!CUSTOM_BACKGROUNDS.length) return null;
    if (S.settings.bgMode === 'select' && S.settings.bgName) {
        const found = CUSTOM_BACKGROUNDS.find(b => b.name === S.settings.bgName);
        if (found) return found;
    }
    return CUSTOM_BACKGROUNDS[Math.floor(Math.random() * CUSTOM_BACKGROUNDS.length)];
}

/** 依設定套用登入背景（設定 stage 底層背景圖的 src 為內嵌 data URI） */
export function applyBackground() {
    const img = document.getElementById('lce-bg-img');
    if (!img) return;
    const bg = pickBackground();
    if (!bg) return; // Images/ 為空時，僅保留暗化遮罩
    if (img.src !== bg.url) img.src = bg.url;
}
