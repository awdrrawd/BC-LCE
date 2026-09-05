// ════════════════════════════════════════════════════════════════════════════
// 信息凍結（Chat Scroll Freeze）—— 按需載入外部插件
//
// 這個功能本體不寫在 LCE，而是沿用 awdrrawd 維護的獨立插件 BC_ChatScrollFreeze.js
// （多個 Liko 插件共用的系統擴充）。理由是「單一正本、不用兩邊維護」：凍結邏輯與內建
// 搜尋都在那支裡演進，LCE 只負責「使用者開了設定就把它載進來」。
//
// 為什麼用動態注入而不是 import()：
//   那支是 standalone userscript（IIFE 自執行、無 GM_* 依賴、"use strict"），不是 ES
//   module，import() 進不來。改用注入一個 <script src>；走 jsDelivr 是因為它以正確的
//   application/javascript MIME + CORS 供檔（GitHub raw 帶 nosniff 會被瀏覽器拒絕當
//   腳本執行），且 loader 的 icon 本來就信任這個 CDN。
//
// 供應鏈取捨（知情選擇）：@main 會自動追上游，換來的是「上游一改、下次載入就跟著變」。
// 因為只在使用者「明示開啟」時才載，風險被限縮在自願啟用的人身上。
//
// ── 開關語意：只決定「要不要載入」，不決定「要不要移除」───────────────────────
//   BC_ChatScrollFreeze 是多個 Liko 插件（LCE / MAT …）共用的同一支。載入與否是
//   「任一方要就載」的 OR 關係，去重靠模組本體開頭的
//   `if (window.Liko.__Sys_ChatScrollFreeze__) return;` 守衛。
//   • 開啟 → 沒載過就注入（已被別人載入就沿用，不重複）。
//   • 關閉 → 什麼都不做，刻意「不 teardown、不移除」。
//     【勿再於關閉時 teardown】：那會在「LCE 沒開、但 MAT 開著」（或反過來）時把對方已載入的
//     實體一起砍掉 —— 實測過的反例就是「MAT 沒開、LCE 有開，卻被對方關閉分支 teardown 掉，結果
//     整個沒載入」。停用只代表 LCE 這次不主動載，已載入的維持載入（要移除得重整頁面）。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';

const LOG = '🐈‍⬛ [LCE]';
const SETTING = 'chatScrollFreeze';
const SRC = 'https://cdn.jsdelivr.net/gh/awdrrawd/liko-Plugin-Repository@main/Plugins/expand/BC_ChatScrollFreeze.js';

let injected = false;   // 本 session 已注入過腳本（避免同一分頁重複抓檔）

/** 外部插件對外掛的 API（存在即代表已載入 —— 不論是我們、MAT 還是使用者自行安裝的）。 */
const externalApi = () => window.Liko?.__Sys_ChatScrollFreeze__ ?? null;

function enable() {
    if (externalApi() || injected) return;   // 已載入或注入中 → 去重，不重複載
    injected = true;
    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    el.dataset.lce = 'chat-scroll-freeze';
    el.onload = () => console.info(LOG, '信息凍結插件已載入');
    el.onerror = () => {
        injected = false;   // 載入失敗（網路 / CSP）→ 放行重試，別卡在「以為載過了」
        console.warn(LOG, '信息凍結插件載入失敗（網路或 CSP 阻擋）:', SRC);
    };
    (document.head || document.documentElement).appendChild(el);
}

export function installChatScrollFreeze() {
    if (getFeature(SETTING)) enable();

    // 使用者在設定頁（或透過 setFeature / 指令）開啟時即時載入。
    // 關閉不處理：見檔頭「只決定要不要載入，不決定要不要移除」。
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e?.detail?.key !== SETTING) return;
        if (e.detail.value) enable();
    });
}
