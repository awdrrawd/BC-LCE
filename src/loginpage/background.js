// ════════════════════════════════════════════════════════════════════════════
// 登入背景
// 使用專案 Images/ 資料夾內的自訂圖片（BG-01.jpg…）。Vite 於建置時把圖片輸出成
// 獨立的 hash 檔（可被瀏覽器快取），URL 以 import.meta.url 相對 bundle 解析，跨來源
// 載入也正確。在 stage 最底層鋪一張滿版背景圖蓋住整個 canvas —— 同時遮住 BC 的登入
// 角色/感謝名單，以及 WCE 畫在 canvas 上的存檔按鈕（點4、點5）。
// 新增圖片只要丟進 Images/ 依檔名排序即可自動納入（無需改程式，重新 build 即可）。
// ════════════════════════════════════════════════════════════════════════════

import { S } from '../core/state.js';
import { WALLPAPER_UPLOAD_SENTINEL } from '../core/constants.js';
import { loadWallpaper } from '../core/storage.js';

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

/**
 * 上傳桌布用的 object URL。每次重建都要把上一個 revoke 掉 ——
 * object URL 會一直抓著整顆 Blob 不放，反覆換背景就會把記憶體吃光。
 */
let uploadedObjectUrl = null;

function releaseUploadedUrl() {
    if (uploadedObjectUrl) { URL.revokeObjectURL(uploadedObjectUrl); uploadedObjectUrl = null; }
}

/** 這一輪是否已經退回過內建背景（見 handleBackgroundError）。 */
let fellBack = false;

/**
 * 背景圖載入失敗時的補救。自訂網址是很容易壞的東西 —— 圖床砍圖、防盜連、
 * 對方站台掛掉都會讓它載不出來，這時候不能讓登入頁開天窗，退回內建背景。
 * 只退一次：內建圖是打包進來的、不會再失敗，真失敗了也不該無限重試。
 */
export function handleBackgroundError() {
    const img = document.getElementById('lce-bg-img');
    if (!img) return;
    if (fellBack) { img.style.display = 'none'; return; }
    fellBack = true;
    releaseUploadedUrl();
    const bg = pickBackground();
    if (bg) { img.src = bg.url; return; }
    img.style.display = 'none';
}

/** 取得自訂桌布的網址：可能是使用者填的 URL，也可能是上傳進 DB 的那張。 */
async function resolveCustomUrl() {
    const v = S.settings.bgCustomUrl;
    if (!v) return null;
    if (v !== WALLPAPER_UPLOAD_SENTINEL) return v;   // 一般網址，直接用
    const blob = await loadWallpaper();
    if (!blob) return null;                          // 設成上傳但 DB 裡沒東西 → 交回去退回隨機
    releaseUploadedUrl();
    uploadedObjectUrl = URL.createObjectURL(blob);
    return uploadedObjectUrl;
}

/**
 * 依設定套用登入背景。
 * custom 模式要讀 IndexedDB，所以是非同步的；呼叫端不需要等它（背景晚一拍出現無妨）。
 */
export async function applyBackground() {
    const img = document.getElementById('lce-bg-img');
    if (!img) return;
    fellBack = false;   // 換了新來源，之前那次的失敗不算數

    if (S.settings.bgMode === 'custom') {
        const url = await resolveCustomUrl();
        if (url) {
            // 換過去之前先確定 img 還在（等 DB 的期間使用者可能已經登入、UI 被拆掉了）
            if (!document.getElementById('lce-bg-img')) { releaseUploadedUrl(); return; }
            img.style.display = '';
            if (img.src !== url) img.src = url;
            return;
        }
        // 網址空的或 DB 裡沒圖 → 不要讓畫面開天窗，退回內建背景
    }

    releaseUploadedUrl();
    const bg = pickBackground();
    if (!bg) return; // Images/ 為空時，僅保留暗化遮罩
    img.style.display = '';
    if (img.src !== bg.url) img.src = bg.url;
}
