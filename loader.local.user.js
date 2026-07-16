// ==UserScript==
// @name         Liko - LCE - 本地版
// @name:zh      Liko的俱樂部擴充 - 本地開發版
// @namespace    https://github.com/awdrrawd/liko-Plugin-Repository
// @version      0.1.0
// @description  Liko Club Extensions (local dev loader)
// @author       Likolisu
// @include      /^https:\/\/(www\.)?bondage(projects\.elementfx|-(europe|asia))\.com\/.*/
// @icon         https://cdn.jsdelivr.net/gh/awdrrawd/liko-Plugin-Repository@main/Images/PCM_ICON.png
// @grant        none
// @run-at       document-end
// ==/UserScript==

// 本地開發載入器：從本地 vite preview 伺服器讀取 bundle。
// 執行 ` npm run dev `（或雙擊 run_dev.bat），再重新整理 BC。
// ?v= 時間戳用來破除快取，讓每次重載都拿到最新 build。
window.Liko = window.Liko ?? {};
if (window.Liko.LCE && window.Liko.LCE.version) {
  console.warn('🐈‍⬛ [LCE] ⚠️ Already loaded, skipping duplicate import.');
} else {
  import(`http://localhost:5174/assets/main.js?v=` + new Date().getTime());
}
