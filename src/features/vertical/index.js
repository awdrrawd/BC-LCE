// ════════════════════════════════════════════════════════════════════════════
// 直式版面（UI 替換）—— 移植自 MPL
//
//   verticalChatRoom    聊天室 + 對話框（chatroom.js 的 cr* / dr*）
//   verticalChatSearch  房間清單 + 房間類型選擇（chatsearch.js 的 csh* / cs*）
//   verticalLogin       登入頁 —— 不在這裡，見 loginpage/（登入前讀不到 DB 設定）
//
// 與 MPL 的差異：MPL 只看螢幕方向就套用，LCE 是「直向 且 該項設定開啟」才套用。
// 每個模組都必須能隨時 remove 還原，因為使用者可能隨時轉螢幕或關設定。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../../modsdk.js';
import { getFeature } from '../../core/feature-settings.js';
import { isPortrait } from '../../core/util.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';
import {
    crApply, crRemove, crMaintain, isCrActive, isFakeInputVisible,
    drApply, drRemove, drMaintain, drMoveDomElements, isDrActive,
    injectChatRoomStyles, removeChatRoomStyles,
} from './chatroom.js';
import {
    csApply, csRemove, buildCsBg, isCsActive,
    cshApply, cshRemove, renderCshList, isCshActive, cshMarkNeedSync, cshSyncIfNeeded,
} from './chatsearch.js';

const LOG = '🐈‍⬛ [LCE]';

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'vertical hook 未掛上:', name, e?.message ?? e); }
}

const wantCr = () => isPortrait() && getFeature('verticalChatRoom');
const wantCsh = () => isPortrait() && getFeature('verticalChatSearch');

/** 關掉所有直式模組（轉橫向、關設定、離開相關畫面時）。 */
function removeAll() {
    if (isCrActive()) crRemove();
    if (isDrActive()) drRemove();
    if (isCsActive()) csRemove();
    if (isCshActive()) cshRemove();
}

/** 每幀由 DrawProcess 呼叫：依目前場景決定要啟用/關閉哪個直式模組。 */
function checkScene() {
    const scr = typeof CurrentScreen !== 'undefined' ? CurrentScreen : '';
    const hasDialog = typeof CurrentCharacter !== 'undefined' && CurrentCharacter !== null;
    const cr = wantCr();
    const csh = wantCsh();

    // 聊天室 + 對話框：兩者互斥
    if (cr && scr === 'ChatRoom' && hasDialog) {
        if (isCrActive()) crRemove();
        if (!isDrActive()) drApply();
    } else if (cr && scr === 'ChatRoom' && !hasDialog) {
        if (isDrActive()) drRemove();
        if (!isCrActive()) crApply();
    } else {
        if (isCrActive()) crRemove();
        if (isDrActive()) drRemove();
    }

    // 房間清單：ChatSearch 與 ChatSelect 互斥
    if (csh && scr === 'ChatSearch') {
        if (isCsActive()) csRemove();
        if (!isCshActive()) cshApply();
    } else if (csh && scr === 'ChatSelect') {
        if (isCshActive()) cshRemove();
        if (!isCsActive()) csApply();
    } else {
        if (isCsActive()) csRemove();
        if (isCshActive()) cshRemove();
    }
}

function handleResize() {
    // 假輸入框開著時不重算：手機鍵盤彈出會觸發 resize，重算會把版面弄爛
    if (isFakeInputVisible()) return;
    if (isCrActive()) { if (!wantCr()) crRemove(); else crMaintain(); }
    if (isDrActive()) { if (!wantCr()) drRemove(); else { drMaintain(); drMoveDomElements(); } }
    if (isCsActive()) { csRemove(); if (wantCsh()) csApply(); }
    if (isCshActive()) { if (!wantCsh()) cshRemove(); else renderCshList(false); }
}

let installed = false;

export function installVertical() {
    if (installed) return;
    installed = true;

    injectChatRoomStyles();

    hook('ChatRoomTopMenuPosition', 0, (args, next) => {
        if (isCrActive()) { crMaintain(); return; }
        return next(args);
    });
    hook('ChatRoomResize', 0, (args, next) => { const r = next(args); crMaintain(); return r; });
    hook('ChatRoomLeave', 0, (args, next) => { crRemove(); return next(args); });

    hook('DialogLoad', 0, (args, next) => {
        const r = next(args);
        if (wantCr() && !isDrActive()) drApply();
        return r;
    });
    hook('DialogLeave', 0, (args, next) => {
        const r = next(args);
        if (isDrActive()) drRemove();
        return r;
    });

    hook('ChatSearchResultResponse', 0, (args, next) => { const r = next(args); cshMarkNeedSync(); return r; });
    hook('ChatSearchRun', 0, (args, next) => { const r = next(args); cshSyncIfNeeded(); return r; });
    hook('ChatSelectLoad', 0, (args, next) => {
        const r = next(args);
        if (isCsActive()) requestAnimationFrame(buildCsBg);
        return r;
    });
    hook('ChatSearchLoad', 0, (args, next) => {
        const r = next(args);
        // BC 載入後還會非同步補房間資料，等一下再刷才有東西
        if (isCshActive()) setTimeout(() => { if (isCshActive()) renderCshList(); }, 600);
        return r;
    });

    hook('DrawProcess', 5, (args, next) => {
        const r = next(args);
        try {
            checkScene();
            if (isDrActive()) drMaintain();
        } catch (e) { console.warn(LOG, 'vertical checkScene:', e); }
        return r;
    });

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => setTimeout(handleResize, 100));

    // 鍵盤彈出時 visualViewport 會縮小，假輸入框覆蓋層要跟著縮才不會被推走
    window.visualViewport?.addEventListener('resize', () => {
        const overlay = document.getElementById('lce-cr-fake-input-overlay');
        if (overlay) overlay.style.height = window.visualViewport.height + 'px';
    });

    // 設定被關掉時立刻還原，不用等使用者轉螢幕
    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e.detail?.key === 'verticalChatRoom' || e.detail?.key === 'verticalChatSearch') {
            try { checkScene(); } catch { /* ignore */ }
        }
    });
}

/** 全部關閉並還原（供 console 或除錯用）。 */
export function uninstallVertical() {
    removeAll();
    removeChatRoomStyles();
}
