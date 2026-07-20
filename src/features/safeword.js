// ════════════════════════════════════════════════════════════════════════════
// 安全詞不變更互動權限（safewordKeepPermission）—— 參考 ULTRAbc 的 fixperm
//
// BC 的 ChatRoomSafewordRevert（使用安全詞「回復」時）會把玩家的互動權限
// 自動收緊到「白名單以上」（OwnerLoversWhitelistOnly，見 BC ChatRoom.js）：
//     if (Player.AllowedInteractions < OwnerLoversWhitelistOnly) { 收緊 + 同步伺服器 }
// 對「把安全詞當聊天/情境重置」而非「真的要拒絕所有人」的玩家來說，這個副作用很煩 ——
// 原本設「所有人／黑名單除外」的權限會被硬改掉，事後還要自己改回來。
//
// 開啟此設定後：在 BC 收緊權限之後，把它還原成回復前的值並同步回伺服器
//（不重寫整個回復流程，只撤銷「權限」這一項，對 BC 版本變動最穩）。預設關閉。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';
let installed = false;

/** 無條件掛 hook，執行時才看設定 —— 與其他 LCE 功能一致，切換設定即時生效、免重整。 */
export function installSafeword() {
    if (installed) return;
    installed = true;

    try {
        modApi.hookFunction('ChatRoomSafewordRevert', 4, (args, next) => {
            if (!getFeature('safewordKeepPermission')) return next(args);

            const prev = Player?.AllowedInteractions;
            const ret = next(args);   // 讓 BC 照常回復外觀/姿勢，也照常（暫時）收緊權限

            try {
                // BC 收緊了權限就還原回去。只在真的被改動時才動作、才送伺服器。
                if (Player && typeof prev === 'number' && Player.AllowedInteractions !== prev) {
                    Player.AllowedInteractions = prev;
                    // QueueData 會依鍵合併、最後一筆生效：BC 剛排入的收緊值會被這筆覆蓋。
                    if (typeof ServerAccountUpdate !== 'undefined' && typeof ServerAccountUpdate?.QueueData === 'function') {
                        ServerAccountUpdate.QueueData({ AllowedInteractions: prev, ItemPermission: prev }, true);
                    }
                    if (typeof ChatRoomCharacterUpdate === 'function') ChatRoomCharacterUpdate(Player);
                }
            } catch (e) { console.warn(LOG, '安全詞保留互動權限失敗:', e); }

            return ret;
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomSafewordRevert hook 未掛上（此 BC 版本可能沒有這個函式）:', e?.message ?? e);
    }
}
