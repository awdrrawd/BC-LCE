// ════════════════════════════════════════════════════════════════════════════
// 雜項
//   插件版本辨識            LCE Hello 只交換版本與能力；完整插件清單交由 BC 原廠遠端查詢
//   ghostNewUsers            自動 ghost + 黑名單「異常新」的帳號（防惡意機器人）
//   customContentDomainCheck 房間自訂背景/音樂來自第三方網域時先確認再載入
// （confirmLeave 在 behaviors.js；relogin 見說明）
// 移植自 WCE shareAddons.ts / autoGhostBroadcast.ts / customContentDomainCheck.js
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
// 與聊天嵌入共用同一份「本次連線已授權來源」名單（WCE 也是共用同一個 map），
// 在聊天嵌入授權過的來源，這裡就不會再問一次。
import { isOriginTrusted, requestOriginTrust, sessionCustomOrigins } from './trusted-domains.js';

const LOG = '🐈‍⬛ [LCE]';
const NEW_ACCOUNT_MS = 30000;              // 建立不到 30 秒就進房 = 異常新（同 WCE）
function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'misc hook 未掛上:', name, e?.message ?? e); }
}

// ───────────────────────── 第三方內容確認 ─────────────────────────
let promptOpen = false;

function askOrigin(origin, type) {
    if (promptOpen) return;
    promptOpen = true;
    const content = T(type === 'image' ? 'domain_image' : type === 'music' ? 'domain_music' : 'domain_content');
    requestOriginTrust(origin, content, { persistent: type === 'image' })
        .finally(() => { promptOpen = false; });
}

let installed = false;

export function installMisc() {
    if (installed) return;
    installed = true;

    // ── 阻止整包 ExtensionSettings 被原樣回傳 ──
    // 登入時的 Player.ExtensionSettings 是伺服器剛下發的資料，不需要在初始化時
    // 再透過 AccountUpdate 驗證或寫回。整包回傳還會把多個大型插件擠進同一則
    // 訊息，容易觸及 180K 的單則上限。
    //
    // 因此看到頂層 ExtensionSettings 時總是移除該欄位：不估算大小、不拆批、
    // 不替所有插件重新同步。同封 AccountUpdate 的其他欄位仍正常送出。
    // 真正有變更的插件應呼叫 ServerPlayerExtensionSettingsSync(key)，只同步自己的
    // ExtensionSettings.<key>；單鍵本身超過 180K 時由該插件自行縮減，LCE 不拆分。
    hook('ServerSend', 100, (args, next) => {
        try {
            const [msgType, data] = args;
            if (msgType === 'AccountUpdate' && data && typeof data === 'object'
                && Object.prototype.hasOwnProperty.call(data, 'ExtensionSettings')) {
                const clean = { ...data };
                delete clean.ExtensionSettings;
                if (Object.keys(clean).length === 0) return null;   // 整封只是不必要的整包回傳
                return next([msgType, clean, ...args.slice(2)]);
            }
        } catch { /* 守衛本身絕不能讓正常送出中斷 */ }
        return next(args);
    });

    // ── 本地版本標記 ──
    // 先把自己的欄位填好，/versions 看自己時才列得出來（本地欄位，別人看不到）。
    if (typeof Player !== 'undefined' && Player) Player.LCE = MOD_VER;

    // ── 異常新帳號自動 ghost + 黑名單 ──
    const onMemberJoin = (data) => {
        try {
            if (!getFeature('ghostNewUsers')) return;
            if (!data?.Character?.Creation) return;
            if (Date.now() - data.Character.Creation >= NEW_ACCOUNT_MS) return;
            ChatRoomListUpdate(Player.BlackList, true, data.Character.MemberNumber);
            if (!Player.GhostList) Player.GhostList = [];
            ChatRoomListUpdate(Player.GhostList, true, data.Character.MemberNumber);
            console.info(LOG, '已自動黑名單異常新帳號:', data.Character.Name, data.Character.MemberNumber,
                `（建立於 ${((Date.now() - data.Character.Creation) / 1000).toFixed(0)} 秒前）`);
        } catch (e) { console.warn(LOG, 'ghostNewUsers 失敗:', e); }
    };
    const bind = () => { try { ServerSocket?.on('ChatRoomSyncMemberJoin', onMemberJoin); } catch { /* ignore */ } };
    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n <= 0) return;
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        bind();
        hook('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; });
    })();

    // ── 房間自訂背景/音樂的網域確認 ──
    hook('ChatAdminRoomCustomizationProcess', 20, (args, next) => {
        if (!getFeature('customContentDomainCheck')) return next(args);
        try {
            const [{ ImageURL, MusicURL }] = args;
            const imageOrigin = ImageURL && new URL(ImageURL).origin;
            const musicOrigin = MusicURL && new URL(MusicURL).origin;

            if (imageOrigin && !isOriginTrusted(imageOrigin) && !sessionCustomOrigins.has(imageOrigin)) askOrigin(imageOrigin, 'image');
            else if (musicOrigin && !sessionCustomOrigins.has(musicOrigin)) askOrigin(musicOrigin, 'music');

            // 全部都已授權才放行；否則擋下（不載入）
            if ((!ImageURL || sessionCustomOrigins.get(imageOrigin) === 'allowed')
                && (!MusicURL || sessionCustomOrigins.get(musicOrigin) === 'allowed')) {
                return next(args);
            }
        } catch { /* URL 解析失敗就當作不放行 */ }
        return null;
    });

    // 自己填的網址視同已授權（不用問自己）
    hook('ChatAdminRoomCustomizationClick', 0, (args, next) => {
        try {
            for (const s of [ElementValue('InputImageURL')?.trim(), ElementValue('InputMusicURL')?.trim()]) {
                try { sessionCustomOrigins.set(new URL(s).origin, 'allowed'); } catch { /* 非網址 */ }
            }
        } catch { /* ignore */ }
        return next(args);
    });
}
