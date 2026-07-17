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
import { installUiColors } from './features/ui-colors.js';
import { installWelcome } from './features/welcome.js';
import { installHello } from './features/hello.js';
import { installBadges } from './features/badges.js';
import { installPastProfiles } from './features/past-profiles.js';
import { installInstantMessenger } from './features/instant-messenger.js';
import { installCharTalk } from './features/char-talk.js';
import { installAntiGarble } from './features/anti-garble.js';
import { installArousal } from './features/arousal.js';
import { installPerformance } from './features/performance.js';
import { installCheats } from './features/cheats.js';
import { installMisc } from './features/misc.js';
import { installWardrobe } from './features/wardrobe.js';
import { installLayeringHide } from './features/layering-hide.js';
import { installRelogin } from './features/relogin.js';
import {
    installExpressions, isExpressionEngineStarted, debugExpressions,
    getExpressionQueue, getExpressionHookOrder, faceComponents,
} from './features/expressions.js';
import { ArousalExpressionStages, EventExpressions, ActivityTriggers } from './features/expressions-data.js';
import { installVertical } from './features/vertical/index.js';
import { injectLoginStyles } from './loginpage/styles.js';
import { refreshAccounts } from './loginpage/account-carousel.js';
import { installLoginPage, teardownLoginPage } from './loginpage/index.js';
import { ensureFusamVisible } from './loginpage/bc.js';

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

    // LCE 自己的介面配色（登入介面、系統訊息、通知氣球）。
    // 必須在 installLoginPage() 之前：登入頁的樣式吃 --lce-login-accent，
    // 晚一步注入的話第一幀會閃一下 fallback 色。
    installUiColors();

    // FUSAM 置頂規則：常駐、與登入頁是否啟用無關 —— 遊戲內開插件管理器時也要蓋過 LCE 浮層。
    ensureFusamVisible();

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
                installWelcome();
                installHello();
                installBadges();
                installPastProfiles();
                installInstantMessenger();
                installCharTalk();
                installAntiGarble();
                installArousal();
                installPerformance();
                installCheats();
                installMisc();
                installWardrobe();
                installLayeringHide();
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
            // 表情引擎診斷：debugExpressions(true) 後做一次活動即可看到完整流程；
            // 表情不如預期時的順序 —— getExpressionHookOrder()（與其他模組衝突，
            // 'Liko - LCE' 必須排最後）→ getExpressionQueue()（事件有沒有進來）
            // → getFaceComponents()（該部位在不在引擎管轄內）
            isExpressionEngineStarted,
            debugExpressions,
            getExpressionQueue,
            getExpressionHookOrder,
            getFaceComponents: faceComponents,
            // 表情資料表（唯讀參考：什麼活動觸發什麼表情、各慾望階段對應的表情）
            expressionData: Object.freeze({ ArousalExpressionStages, EventExpressions, ActivityTriggers }),
            teardownLoginUI: teardownLoginPage,
            // 功能設定
            getFeature,
            setFeature,
            // 主題色 API
            getMainColor,
            getAccentColor,
            getTextColor,
            getPalette,
            isDarkTheme,
        });

        // settings 必須用 defineProperty 定義成真的 getter，不能寫在上面的 Object.assign 裡：
        // Object.assign 會「呼叫」來源的 getter、把當下的『值』複製過去，getter 本身不會被搬過來。
        // 而 loadFeatureSettings() 是非同步的、結束時會把 fSettings 換成一個全新物件
        // （fSettings = settings），所以 Object.assign 抓到的是還沒載入前那個空殼 ——
        // window.Liko.LCE.settings 會永遠指著一個被丟掉的舊物件，讀不到也改不動真正的設定。
        Object.defineProperty(window.Liko.LCE, 'settings', {
            get() { return fSettings; },
            configurable: true,
        });

        console.log('🐈‍⬛ [LCE] Liko Club Extensions v' + MOD_VER + ' 已載入');
    })();
}
