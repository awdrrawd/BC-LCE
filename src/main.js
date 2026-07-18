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
import { Theme, isThemeEnabled, getMainColor, getAccentColor, getTextColor, getPalette, isDarkTheme } from './core/theme-api.js';
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

    const LOG = '🐈‍⬛ [LCE]';
    // 逐步初始化：單一步驟丟例外只記警告並跳過，不會連累後面的模組
    //（原本全部擠在一個 .then() 裡，任一個 throw 就整串中斷，一顆壞掉半個插件就黑了）。
    const safe = (label, fn) => {
        try { fn(); }
        catch (e) { console.warn(LOG, `初始化步驟「${label}」失敗（已跳過，不影響其他模組）:`, e); }
    };

    // ── 登入前就要就緒的（登入頁的版面/染色/FUSAM 都吃這些） ──
    // initGlobalFeatures / installUiColors 必須在 installLoginPage 之前：登入頁第一次套版就要讀得到
    // 全域設定與 --lce-login-accent，晚一步第一幀會閃 fallback 色。
    safe('全域設定', initGlobalFeatures);
    safe('介面配色', installUiColors);
    safe('FUSAM 置頂', ensureFusamVisible);   // 常駐，遊戲內開插件管理器也要蓋過 LCE 浮層
    safe('登入頁', installLoginPage);

    // 等待 BC 核心就緒。globals 通常在腳本執行前後就出現，用較短間隔讓初始化更即時
    //（總等待上限仍約 60 秒，只是把 500ms×120 改細成 150ms×400，抓到就馬上往下走）。
    (function waitForBC(n = 0) {
        const MAX_RETRIES = 400, POLL_MS = 150;
        if (typeof Player === 'undefined' || typeof CurrentScreen === 'undefined') {
            if (n >= MAX_RETRIES) { console.warn(LOG, '等待 BC 核心逾時，插件停止初始化'); return; }
            setTimeout(() => waitForBC(n + 1), POLL_MS);
            return;
        }

        safe('登入頁樣式', injectLoginStyles);
        getCryptoKey().catch(e => console.warn(LOG, '加密系統初始化失敗:', e));

        // 功能設定：等帳號就緒 → 載入 → 依序安裝各功能（每步各自 try/catch）。
        // 登入頁的全域設定（lce_settings）不受影響，仍可在未登入時運作。
        loadFeatureSettings()
            .then(() => {
                // 順序有意義：themeEngine 必須最先（否則漏染其他步驟建立的 HTML 按鈕）、
                // applyTheme 必須最後（等所有 sideEffects 套好再統一上色）。中間順序不敏感。
                const steps = [
                    ['主題引擎', installThemeEngine],
                    ['設定頁', installSettingsPage],
                    ['設定副作用', postFeatureSettings],
                    ['指令', installCommander],
                    ['行為', installBehaviors],
                    ['個人檔案', installProfile],
                    ['聊天', installChat],
                    ['聊天嵌入', installChatAugments],
                    ['待送訊息', installPendingMessages],
                    ['好友上下線', installFriendPresence],
                    ['本地訊息', installLocalMessages],
                    ['歡迎訊息', installWelcome],
                    ['打招呼', installHello],
                    ['徽章', installBadges],
                    ['歷史檔案', installPastProfiles],
                    ['即時通訊', installInstantMessenger],
                    ['角色對話', installCharTalk],
                    ['防亂碼', installAntiGarble],
                    ['慾望', installArousal],
                    ['效能', installPerformance],
                    ['作弊/反作弊', installCheats],
                    ['雜項', installMisc],
                    ['衣櫃', installWardrobe],
                    ['圖層隱藏', installLayeringHide],
                    ['自動重連', installRelogin],
                    ['表情引擎', installExpressions],
                    ['直式版面', installVertical],
                    ['套用主題', applyTheme],
                ];
                for (const [label, fn] of steps) safe(label, fn);
            })
            .catch(e => console.warn(LOG, '功能設定載入失敗（各功能未安裝）:', e));

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
            // 主題色 API：建議用 LCE.Theme.*（Theme.enabled 判斷開關；未啟用時顏色一律 null）。
            Theme,
            isThemeEnabled,
            // 向後相容的扁平取色（等同 Theme.*，未啟用時同樣回 null）
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
