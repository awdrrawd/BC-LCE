// ==UserScript==
// @name         Liko - LCE - Loader
// @name:zh      Liko的俱樂部擴充 - 載入器
// @namespace    https://github.com/awdrrawd/BC-LCE
// @version      0.1.2
// @description  Liko Club Extensions - horizontal login UI and club extensions for Bondage Club.
// @author       Likolisu
// @include      /^https:\/\/(www\.)?bondage(projects\.elementfx|-(europe|asia))\.com\/.*/
// @icon         https://cdn.jsdelivr.net/gh/awdrrawd/liko-Plugin-Repository@main/Images/PCM_ICON.png
// @grant        none
// @run-at       document-end
// @downloadURL  https://awdrrawd.github.io/BC-LCE/loader.user.js
// @updateURL    https://awdrrawd.github.io/BC-LCE/loader.user.js
// ==/UserScript==

// 真正的重複載入防護在 bundle 內（src/main.js）。這裡只是提早警告，不擁有旗標。
window.Liko = window.Liko ?? {};
if (window.Liko.LCE && window.Liko.LCE.version) {
  console.warn('🐈‍⬛ [LCE] ⚠️ Already loaded, skipping duplicate import.');
} else {
  import(`https://awdrrawd.github.io/BC-LCE/assets/main.js?v=` + new Date().getTime());
}
