// ════════════════════════════════════════════════════════════════════════════
// 信息凍結（Chat Scroll Freeze）—— 按需載入外部插件
//
// 這個功能本體不寫在 LCE，而是沿用 awdrrawd 維護的獨立插件 BC_ChatScrollFreeze.js
// （PCM / LCE 共用系統擴充）。理由是「單一正本、不用兩邊維護」：凍結邏輯與內建搜尋
// 都在那支裡演進，LCE 只負責「使用者開了設定才把它載進來、關了就停掉」。
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
// 生命週期（受外部插件的介面限制，見 __Sys_ChatScrollFreeze__）：
//   • 開啟 → 注入腳本，它自我守衛、只會初始化一次。
//   • 關閉 → 呼叫它的 teardown()，移除所有鉤子、行為即時停止。
//   • 但 teardown 不會清掉它的全域守衛旗標，且它沒有對外的「重新初始化」介面 ——
//     所以「本工作階段內關掉後再開」無法就地復活，需重新整理頁面。這一點照實告知使用者。
//   • 若偵測到外部（standalone PCM 版或使用者自行安裝）已載入同一支，就沿用、不重複注入，
//     且關閉時不代它 teardown（那不是我們載的，不該替別人收掉）。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';

const LOG = '🐈‍⬛ [LCE]';
const SETTING = 'chatScrollFreeze';
const SRC = 'https://cdn.jsdelivr.net/gh/awdrrawd/liko-Plugin-Repository@main/Plugins/expand/BC_ChatScrollFreeze.js';

let injected = false;    // 本 session 已注入過腳本（避免重複載入）
let ownedByUs = false;   // 目前運作中的那份是「我們注入的」（決定關閉時該不該代為 teardown）
let tornDown = false;    // 本 session 內曾 teardown 過（外部插件無法就地重啟）

/** 外部插件對外掛的 API（存在即代表已載入）。 */
const externalApi = () => window.Liko?.__Sys_ChatScrollFreeze__ ?? null;

function injectScript() {
    // 外部已載入 → 沿用它，不重複注入，也不標記為我們所有。
    if (externalApi()) {
        injected = true;
        console.info(LOG, '信息凍結：偵測到外部已載入，沿用之');
        return;
    }
    injected = true;
    ownedByUs = true;
    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    el.dataset.lce = 'chat-scroll-freeze';
    el.onload = () => console.info(LOG, '信息凍結插件已載入');
    el.onerror = () => {
        // 載入失敗（網路 / CSP）：放行重試，別把 session 卡死在「以為載過了」。
        injected = false;
        ownedByUs = false;
        console.warn(LOG, '信息凍結插件載入失敗（網路或 CSP 阻擋）:', SRC);
    };
    (document.head || document.documentElement).appendChild(el);
}

function enable() {
    if (tornDown) {
        // 外部插件關閉後無法就地重啟（見檔頭）。照實說，別假裝開起來了。
        console.info(LOG, '信息凍結：本工作階段曾停用，需重新整理頁面才能再次啟用');
        return;
    }
    if (injected) return;   // 已在運作
    injectScript();
}

function disable() {
    if (!ownedByUs) return;   // 沒載過、或那份是外部的 → 不代為收掉
    const api = externalApi();
    if (api?.teardown) {
        try { api.teardown(); tornDown = true; }
        catch (e) { console.warn(LOG, '信息凍結 teardown 失敗:', e?.message ?? e); }
    }
}

export function installChatScrollFreeze() {
    if (getFeature(SETTING)) enable();

    // 使用者在設定頁（或透過 setFeature / 指令）切換時即時反應。
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e?.detail?.key !== SETTING) return;
        if (e.detail.value) enable();
        else disable();
    });
}
