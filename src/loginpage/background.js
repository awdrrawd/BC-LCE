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

// 背景影片（可選）：命名規則 BGV-XX.mp4，對應同號的圖片 BG-XX.jpg。
// 有對應影片的背景會「先出圖、影片載好再淡入」（見 applyVideo）；沒有影片的就純圖片。
const _videoModules = import.meta.glob('../../Images/*.{mp4,webm}', { eager: true, import: 'default' });

/** @type {Record<string,string>} 影片名（去副檔名）→ 輸出檔 URL，例如 'BGV-01' → 'assets/BGV-01-xxxx.mp4' */
const VIDEO_BY_NAME = {};
for (const path of Object.keys(_videoModules)) {
    const n = path.split('/').pop().replace(/\.[^.]+$/, '');
    VIDEO_BY_NAME[n] = _videoModules[path];
}

/**
 * 找出某張圖片對應的背景影片：BG-01 → BGV-01。
 * 只把 BG 前綴換成 BGV、其餘（-01）照舊，所以編號一致才會配對到；沒有就回 null。
 */
function videoFor(imgName) {
    const m = /^BG(.*)$/.exec(imgName);
    if (!m) return null;
    return VIDEO_BY_NAME['BGV' + m[1]] || null;
}

/** @type {{ name: string, url: string, video: string|null }[]} 依檔名排序的自訂背景清單 */
export const CUSTOM_BACKGROUNDS = Object.keys(_modules)
    .sort()
    .map(path => {
        const name = path.split('/').pop().replace(/\.[^.]+$/, '');
        return { name, url: _modules[path], video: videoFor(name) };
    });

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

// ── 背景影片（漸進式增強）────────────────────────────────────────────────
// 圖片一律先鋪上（applyBackground 做的），影片在背景默默下載，載到能流暢播放
// （canplaythrough）才淡入蓋住圖片；下載失敗或太慢就維持圖片，不拖累整體體驗。
// 每次切背景都換一個 token：上一支影片若在切換後才下載完，它的 canplaythrough
// 會因 token 不符而被忽略，不會誤蓋到新背景上。
let videoToken = 0;

/** 停播並清空背景影片（切成純圖片 / 自訂桌布 / 退回內建圖時呼叫）。load() 才會真的中止下載。 */
function clearVideo() {
    videoToken++;
    const v = document.getElementById('lce-bg-video');
    if (!v) return;
    v.oncanplaythrough = null;
    v.onerror = null;
    try { v.pause(); } catch { /* ignore */ }
    v.removeAttribute('src');
    v.style.opacity = '0';
    v.style.display = 'none';
    try { v.load(); } catch { /* ignore */ }
}

/** 掛上一支背景影片：圖片已在畫面上，這裡只負責「準備好就靜音淡入」。 */
function applyVideo(url) {
    const v = document.getElementById('lce-bg-video');
    if (!v || !url) return;
    const token = ++videoToken;
    v.style.display = '';
    v.style.opacity = '0';

    v.oncanplaythrough = () => {
        if (token !== videoToken) return;                 // 已被下一次切背景取代
        if (!document.getElementById('lce-bg-video')) return;
        v.style.opacity = '1';                            // 淡入蓋住圖片（CSS transition）
        // 靜音影片本就允許自動播放；被瀏覽器擋下也只是留在圖片，不需處理。
        v.play?.().catch(() => {});
    };
    v.onerror = () => {
        if (token !== videoToken) return;                 // 圖床砍檔/防盜連 → 靜靜退回圖片
        v.removeAttribute('src');
        v.style.opacity = '0';
        v.style.display = 'none';
    };

    v.src = url;
    try { v.load(); } catch { /* ignore */ }
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
    clearVideo();   // 圖片都載不出來了，影片也一併收掉，退回單純的內建圖
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
            clearVideo();   // 自訂桌布（網址/上傳）只有圖片，沒有對應影片
            img.style.display = '';
            if (img.src !== url) img.src = url;
            return;
        }
        // 網址空的或 DB 裡沒圖 → 不要讓畫面開天窗，退回內建背景
    }

    releaseUploadedUrl();
    const bg = pickBackground();
    if (!bg) { clearVideo(); return; } // Images/ 為空時，僅保留暗化遮罩
    img.style.display = '';
    if (img.src !== bg.url) img.src = bg.url;
    // 有對應影片 → 準備好就淡入；沒有 → 收掉上一支、維持純圖片
    if (bg.video) applyVideo(bg.video);
    else clearVideo();
}
