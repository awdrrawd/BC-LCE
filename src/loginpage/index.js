// ════════════════════════════════════════════════════════════════════════════
// 登入頁模組總管：註冊 / 卸載登入相關的 BC 鉤子與視窗事件。
//
// 點6：BC 無法登出（只能 F5 刷新），所以登入成功後這整組登入介面就不再會用到。
// 為了不讓每幀的 DrawProcess hook 等持續佔資源，登入成功後「熱移除」整個登入頁
// （解除 hook、移除 DOM 與監聽）。唯一要保留的是登入快照 —— 它以 setTimeout 排程，
// 解除 hook 後仍會照常執行。日後其他功能各自獨立安裝，不受此處卸載影響。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { S, saveSettings } from '../core/state.js';
import { captureAndSaveProfile } from '../core/storage.js';
import {
    checkScene, lceRemove, lceLayout, handleResize, destroyLoginUI,
} from './login-ui.js';

let unhooks = [];
let resizeHandler = null, orientHandler = null, resizeTimer = null;
let installed = false;

export function installLoginPage() {
    if (installed) return;
    installed = true;

    unhooks.push(modApi.hookFunction('LoginResponse', 0, (args, next) => {
        const result = next(args);
        // 只有登入成功（回傳物件而非錯誤字串）才擷取快照並熱移除登入介面
        if (args[0] && typeof args[0] === 'object') {
            // 記住這次登入的帳號，下次開啟登入頁時自動選定
            try {
                const name = args[0].AccountName || document.getElementById('lce-input-name')?.value || '';
                if (name) { S.settings.lastAccount = name; saveSettings(); }
            } catch { /* ignore */ }
            setTimeout(captureAndSaveProfile, 5000); // 等角色資料/外觀載入後擷取頭像
            setTimeout(teardownLoginPage, 800);      // 之後不再需要登入介面，釋放資源
        }
        return result;
    }));

    unhooks.push(modApi.hookFunction('LoginLoad', 0, (args, next) => {
        const r = next(args);
        // 交給 checkScene 判斷（含直向 + verticalLogin），避免這裡與它的條件各寫一份
        setTimeout(checkScene, 50);
        return r;
    }));

    unhooks.push(modApi.hookFunction('LoginUnload', 0, (args, next) => {
        lceRemove();
        return next(args);
    }));

    unhooks.push(modApi.hookFunction('DrawProcess', 5, (args, next) => {
        next(args);
        checkScene();
        if (S.active) lceLayout();
    }));

    resizeHandler = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(handleResize, 120); };
    orientHandler = () => setTimeout(handleResize, 250);
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', orientHandler);
}

/** 熱移除整個登入頁：解除所有 hook、移除 DOM 與監聽（快照仍會執行） */
export function teardownLoginPage() {
    if (!installed) return;
    installed = false;

    destroyLoginUI();

    unhooks.forEach(unhook => { try { unhook(); } catch { /* ignore */ } });
    unhooks = [];

    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    if (orientHandler) window.removeEventListener('orientationchange', orientHandler);
    clearTimeout(resizeTimer);
    resizeHandler = orientHandler = null;

    console.log('🐈‍⬛ [LCE] 登入介面已於登入後熱移除（快照仍會執行）');
}
