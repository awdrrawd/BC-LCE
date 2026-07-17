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
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
// 與聊天嵌入共用同一份「本次連線已授權來源」名單（WCE 也是共用同一個 map），
// 在聊天嵌入授權過的來源，這裡就不會再問一次。
import { sessionCustomOrigins } from './chat-augments.js';
import { sendLceHello } from './hello.js';

const LOG = '🐈‍⬛ [LCE]';
const NEW_ACCOUNT_MS = 30000;              // 建立不到 30 秒就進房 = 異常新（同 WCE）
const TRUSTED = ['https://fs.kinkop.eu', 'https://i.imgur.com'];

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

    // ── 防止「整包 ExtensionSettings」被送出（對應 WCE commonPatches 的 ServerSend 守衛）──
    // BC 只用 dot-notation 同步單一鍵（ServerPlayerExtensionSettingsSync 送 "ExtensionSettings.<key>"）；
    // 沒有任何正常路徑會在 AccountUpdate 夾帶「整包 ExtensionSettings」物件。一旦有插件這麼做：
    //   1. 伺服器會用整包覆蓋雲端 —— 別的插件當下沒載到記憶體的鍵會被連帶抹掉
    //      （WCE 註解稱之為 "settings erasure by client"）。
    //   2. 那則 AccountUpdate 會夾帶全部 ExtensionSettings（動輒數百 KB）—— 就是「巨大送出訊息」報告，
    //      有斷線風險。裝著 WCE 時它會 throw 擋掉，所以問題被藏住；拿掉 WCE 就現形。
    //
    // 比 WCE 更精準：不整封擋掉（那會連同封包裡合法的 OnlineSharedSettings / ConfiscatedItems 一起丟），
    // 只「剝掉 ExtensionSettings」再把其餘欄位照送。ExtensionSettings 的真正變更本來就該走 dot-notation，
    // 剝掉不會漏存合法的單鍵更新。BC 核心從不批次整包 ExtensionSettings，故不會誤傷 BC 本體。
    hook('ServerSend', 100, (args, next) => {
        try {
            const [msgType, data] = args;
            if (msgType === 'AccountUpdate' && data && typeof data === 'object'
                && Object.prototype.hasOwnProperty.call(data, 'ExtensionSettings')) {
                const bytes = (() => { try { return JSON.stringify(data.ExtensionSettings).length; } catch { return '?'; } })();
                console.warn(LOG, `已從一則 AccountUpdate 剝除整包 ExtensionSettings（約 ${bytes} bytes）——`
                    + ' 避免覆蓋雲端設定與巨大送出訊息。ExtensionSettings 請改用'
                    + ' ServerPlayerExtensionSettingsSync(key) 逐鍵同步。');
                const clean = { ...data };
                delete clean.ExtensionSettings;
                // 整封只有 ExtensionSettings → 沒有其他欄位可送，直接擋下。
                if (Object.keys(clean).length === 0) return null;
                return next([msgType, clean, ...args.slice(2)]);
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
