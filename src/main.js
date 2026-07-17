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
import { loadFeatureSettings, postFeatureSettings, getFeature, setFeature, fSettings, initGlobalFeatures } from './core/feature-settings.js';
import { getMainColor, getAccentColor, getTextColor, getPalette, isDarkTheme } from './core/theme-api.js';
import { installSettingsPage } from './settings/settings-page.js';
import { installCommander } from './commands/commander.js';
import { applyTheme, installThemeEngine } from './features/theme.js';
import { installBehaviors } from './features/behaviors.js';
import { installProfile } from './features/profile.js';
import { installChat } from './features/chat.js';
import { installChatAugments } from './features/chat-augments.js';
import { installPendingMessages } from './features/pending-messages.js';
import { installFriendPresence } from './features/friend-presence.js';
import { installLocalMessages } from './features/local-messages.js';
import { installHello } from './features/hello.js';
import { installPastProfiles } from './features/past-profiles.js';
import { installInstantMessenger } from './features/instant-messenger.js';
import { installCharTalk } from './features/char-talk.js';
import { installAntiGarble } from './features/anti-garble.js';
import { installArousal } from './features/arousal.js';
import { installPerformance } from './features/performance.js';
import { installCheats } from './features/cheats.js';
import { installMisc } from './features/misc.js';
import { installWardrobe } from './features/wardrobe.js';
import { installRelogin } from './features/relogin.js';
import { installExpressions, isExpressionEngineStarted, debugExpressions } from './features/expressions.js';
import { installVertical } from './features/vertical/index.js';
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

    // ui / theme 是全域共用設定，登入前就要讀得到（登入頁版面與染色都靠它）。
    // 必須在 installLoginPage() 之前，否則登入頁第一次套版時 getFeature 還是空的。
    initGlobalFeatures();

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

        // 功能設定：等帳號就緒 → 載入 → 註冊設定頁 → 套用初始 sideEffects。
        // 登入頁的全域設定（lce_settings）不受影響，仍可在未登入時運作。
        loadFeatureSettings()
            .then(() => {
                installThemeEngine();   // 必須最先、且無條件掛，晚掛會漏染已建立的 HTML 按鈕
                installSettingsPage();
                postFeatureSettings();
                installCommander();
                installBehaviors();
                installProfile();
                installChat();
                installChatAugments();
                installPendingMessages();
                installFriendPresence();
                installLocalMessages();
                installHello();
                installPastProfiles();
                installInstantMessenger();
                installCharTalk();
                installAntiGarble();
                installArousal();
                installPerformance();
                installCheats();
                installMisc();
                installWardrobe();
                installRelogin();
                installExpressions();
                installVertical();
                applyTheme();
            })
            .catch(e => console.warn('🐈‍⬛ [LCE] 功能設定初始化失敗:', e));

        // 公開 API（供其他插件或 console 使用）
        Object.assign(window.Liko.LCE, {
            version:         MOD_VER,
            refreshI18n,
            reloadSettings,
            refreshAccounts,
            captureProfile:  captureAndSaveProfile,
            // 表情引擎診斷：debugExpressions(true) 後做一次活動即可看到完整流程
            isExpressionEngineStarted,
            debugExpressions,
            teardownLoginUI: teardownLoginPage,
            // 功能設定
            getFeature,
            setFeature,
            get settings() { return fSettings; },
            // 主題色 API
            getMainColor,
            getAccentColor,
            getTextColor,
            getPalette,
            isDarkTheme,
        });

        console.log('🐈‍⬛ [LCE] Liko Club Extensions v' + MOD_VER + ' 已載入');
    })();
}
