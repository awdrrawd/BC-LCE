// ════════════════════════════════════════════════════════════════════════════
// Liko Club Extensions (LCE) — 進入點
// 職責：重複載入防護、安裝各功能模組、等待 BC 核心後初始化、掛載公開 API。
// 各功能（目前只有登入頁）自行管理鉤子與卸載；main 只負責串接。
// ════════════════════════════════════════════════════════════════════════════

import { LCE_ALREADY_LOADED } from './modsdk.js';
import { MOD_VER } from './core/constants.js';
import { reloadSettings } from './core/state.js';
import { refreshI18n } from './core/i18n.js';
import { getCryptoKey, captureAndSaveProfile } from './core/storage.js';
import { injectLoginStyles } from './loginpage/styles.js';
import { refreshAccounts } from './loginpage/account-carousel.js';
import { installLoginPage, teardownLoginPage } from './loginpage/index.js';

// 重複載入防護：已載入就直接結束（loader 也有前置檢查，這裡才是真正的旗標擁有者）。
window.Liko = window.Liko ?? {};
if (LCE_ALREADY_LOADED) {
    console.warn('🐈‍⬛ [LCE] ⚠️ Already loaded, skipping duplicate init.');
} else {
    window.Liko.LCE = window.Liko.LCE ?? {};
    window.Liko.LCE.version = MOD_VER;

    // 安裝登入頁（註冊鉤子與視窗事件）
    installLoginPage();

    // 等待 BC 核心就緒後做一次性初始化
    (function waitForBC(retryCount = 0) {
        const MAX_RETRIES = 120;
        if (typeof Player === 'undefined' || typeof CurrentScreen === 'undefined') {
            if (retryCount >= MAX_RETRIES) {
                console.warn('🐈‍⬛ [LCE] 等待 BC 核心逾時，插件停止初始化');
                return;
            }
            setTimeout(() => waitForBC(retryCount + 1), 500);
            return;
        }

        injectLoginStyles();
        getCryptoKey().catch(e => console.warn('🐈‍⬛ [LCE] 加密系統初始化失敗:', e));

        // 公開 API（供其他插件或 console 使用）
        Object.assign(window.Liko.LCE, {
            version:         MOD_VER,
            refreshI18n,
            reloadSettings,
            refreshAccounts,
            captureProfile:  captureAndSaveProfile,
            teardownLoginUI: teardownLoginPage,
        });

        console.log('🐈‍⬛ [LCE] Liko Club Extensions v' + MOD_VER + ' 已載入');
    })();
}
