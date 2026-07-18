// ════════════════════════════════════════════════════════════════════════════
// 雜項
//   shareAddons              與同房其他 LCE 使用者共享已安裝的插件清單（/versions 可看）
//   ghostNewUsers            自動 ghost + 黑名單「異常新」的帳號（防惡意機器人）
//   customContentDomainCheck 房間自訂背景/音樂來自第三方網域時先確認再載入
// （confirmLeave 在 behaviors.js；relogin 見說明）
// 移植自 WCE shareAddons.ts / autoGhostBroadcast.ts / customContentDomainCheck.js
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER } from '../core/constants.js';
import { byteSize } from '../core/util.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
// 與聊天嵌入共用同一份「本次連線已授權來源」名單（WCE 也是共用同一個 map），
// 在聊天嵌入授權過的來源，這裡就不會再問一次。
import { sessionCustomOrigins } from './chat-augments.js';
import { sendLceHello } from './hello.js';

const LOG = '🐈‍⬛ [LCE]';
const NEW_ACCOUNT_MS = 30000;              // 建立不到 30 秒就進房 = 異常新（同 WCE）
const TRUSTED = ['https://fs.kinkop.eu', 'https://i.imgur.com'];
// 送出訊息的「問題門檻」：與 BCX errorReporting 的 PROBLEMATIC_MESSAGE_SIZE 對齊。
// 這是「單則訊息」的上限（不是帳號總量）—— 伺服器擋的是一口氣送超過這個大小，不是總資料量。
// 所以正解是逐鍵送（dot-notation），總量再大也能靠多則小訊息同步。
const PROBLEMATIC_MESSAGE_SIZE = 180_000;
// 拆批時每則訊息的安全上限，留 margin 給命令名與 JSON 結構。
const SAFE_CHUNK_SIZE = 150_000;

/**
 * 把整包 ExtensionSettings 拆成多則 dot-notation 的 AccountUpdate 送出，每則 < SAFE_CHUNK_SIZE：
 *   • 大鍵（自己就 ≥ 安全上限）單獨一則。
 *   • 其餘小鍵累積裝箱，快滿就先送一箱。
 * dot-notation（"ExtensionSettings.<key>"）是 $set 單鍵、不會覆蓋整包，也不會再觸發本守衛
 * （守衛只認整包的 "ExtensionSettings" 鍵）。回傳送出的訊息則數。
 */
function resyncExtensionSettingsChunked(ext) {
    if (!ext || typeof ext !== 'object' || typeof ServerSend !== 'function') return 0;
    let batch = {};
    let batchBytes = 0;
    let sent = 0;
    const flush = () => {
        if (Object.keys(batch).length === 0) return;
        ServerSend('AccountUpdate', batch);
        sent++; batch = {}; batchBytes = 0;
    };
    for (const [key, val] of Object.entries(ext)) {
        if (val == null) continue;                       // null 佔位（已刪的鍵）不必送
        const path = `ExtensionSettings.${key}`;
        const vBytes = byteSize(val);
        if (vBytes >= SAFE_CHUNK_SIZE) { flush(); ServerSend('AccountUpdate', { [path]: val }); sent++; continue; }
        if (batchBytes + vBytes >= SAFE_CHUNK_SIZE) flush();
        batch[path] = val; batchBytes += vBytes;
    }
    flush();
    return sent;
}

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'misc hook 未掛上:', name, e?.message ?? e); }
}

// ───────────────────────── 第三方內容確認 ─────────────────────────
let promptOpen = false;

function askOrigin(origin, type) {
    if (promptOpen) return;
    if (!(typeof FUSAM === 'object' && FUSAM?.modals)) return;
    promptOpen = true;
    FUSAM.modals.open({
        prompt: T('domain_prompt')
            .replace('{content}', T(type === 'image' ? 'domain_image' : type === 'music' ? 'domain_music' : 'domain_content'))
            .replace('{origin}', origin)
            .replace('{trusted}', TRUSTED.includes(origin) ? T('domain_trusted') : ''),
        callback: (act) => {
            promptOpen = false;
            if (act === 'submit') sessionCustomOrigins.set(origin, 'allowed');
            else if (act === 'cancel') sessionCustomOrigins.set(origin, 'denied');
        },
        buttons: { cancel: T('domain_deny'), submit: T('domain_allow') },
    });
}

let installed = false;

export function installMisc() {
    if (installed) return;
    installed = true;

    // ── 只在「整封大到有斷線風險」時，剝掉整包 ExtensionSettings（對應 WCE 的 ServerSend 守衛）──
    // 有 mod 會用 ServerAccountUpdate.QueueData({ ExtensionSettings: Player.ExtensionSettings }) 強制
    // 整包存檔，由 BC flush 出去。整包送出本身不理想（該走 dot-notation 逐鍵），但只要沒超過伺服器
    // 能吃的大小就不會出事 —— 一個帳號的 ExtensionSettings 正常就有 ~180K。所以**不是看到整包就攔**，
    // 而是只在「整封超過 BCX 認定的問題門檻(PROBLEMATIC_MESSAGE_SIZE=180K)」時才動手，避免干擾正常運作。
    //
    // 動手時也只「剝掉 ExtensionSettings」、其餘欄位（OnlineSharedSettings / ConfiscatedItems…）照送，
    // 比 WCE 直接 throw 整封溫和。ExtensionSettings 的真正變更本來就該走 dot-notation，剝掉不漏存單鍵更新。
    hook('ServerSend', 100, (args, next) => {
        try {
            const [msgType, data] = args;
            if (msgType === 'AccountUpdate' && data && typeof data === 'object'
                && Object.prototype.hasOwnProperty.call(data, 'ExtensionSettings')) {
                const size = byteSize(data);   // 實際送出的 UTF-8 位元組（同伺服器/BCX 的算法）
                // 180K 以內視為正常帳號大小 → 完全放行，不干涉、不噴訊息。
                if (size > PROBLEMATIC_MESSAGE_SIZE) {
                    // 拆成多則 dot-notation 逐鍵補送（每則 < 180K），資料不漏、也不會斷線 ——
                    // 這正是「總量可以大、但要分多則小訊息送」的作法。再把原訊息剝掉 ExtensionSettings
                    // 後把其餘欄位照送。
                    const n = resyncExtensionSettingsChunked(data.ExtensionSettings);
                    console.warn(LOG, `AccountUpdate 過大（約 ${size} bytes > ${PROBLEMATIC_MESSAGE_SIZE}，有斷線風險）——`
                        + ` 已把整包 ExtensionSettings 拆成 ${n} 則逐鍵同步（每則 < ${PROBLEMATIC_MESSAGE_SIZE}）。`
                        + ' 提醒：ExtensionSettings 本來就該用 ServerPlayerExtensionSettingsSync(key) 逐鍵送。');
                    const clean = { ...data };
                    delete clean.ExtensionSettings;
                    if (Object.keys(clean).length === 0) return null;   // 整封只有 ExtensionSettings
                    return next([msgType, clean, ...args.slice(2)]);
                }
            }
        } catch { /* 守衛本身絕不能讓正常送出中斷 */ }
        return next(args);
    });

    // ── 共享插件清單 ──
    // 先把自己的欄位填好，/versions 看自己時才列得出來（本地欄位，別人看不到）。
    if (typeof Player !== 'undefined' && Player) Player.LCE = MOD_VER;

    // 清單有變動時重新報一次名。只寫本地欄位是不夠的 —— 別人的 /versions 要靠
    // LCEMsg 廣播（features/hello.js）才填得到。走的是 LCE 自己的頻道，
    // 不是 WCE 的 BCEMsg，所以不會被別人的 WCE 認成 WCE 使用者。
    setInterval(() => {
        try {
            if (!(typeof ServerIsConnected !== 'undefined' && ServerIsConnected && ServerPlayerIsInChatRoom())) return;
            const loaded = window.bcModSdk?.getModsInfo?.() ?? [];
            if (JSON.stringify(loaded) === JSON.stringify(Player.LCEOtherAddons)) return;
            Player.LCEOtherAddons = loaded;
            if (getFeature('shareAddons')) sendLceHello(null, false);
        } catch { /* ignore */ }
    }, 5000);

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

            if (imageOrigin && !sessionCustomOrigins.has(imageOrigin)) askOrigin(imageOrigin, 'image');
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
