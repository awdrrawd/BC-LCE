// ════════════════════════════════════════════════════════════════════════════
// 雜項
//   shareAddons              與同房其他人共享已安裝的插件清單（/versions 可看）
//   ghostNewUsers            自動 ghost + 黑名單「異常新」的帳號（防惡意機器人）
//   customContentDomainCheck 房間自訂背景/音樂來自第三方網域時先確認再載入
// （confirmLeave 在 behaviors.js；relogin 見說明）
// 移植自 WCE shareAddons.ts / autoGhostBroadcast.ts / customContentDomainCheck.js
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
// 與聊天嵌入共用同一份「本次連線已授權來源」名單（WCE 也是共用同一個 map），
// 在聊天嵌入授權過的來源，這裡就不會再問一次。
import { sessionCustomOrigins } from './chat-augments.js';
import { sendHello } from './hello.js';

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

    // ── 共享插件清單 ──
    // 只寫 Player.FBCOtherAddons 是不夠的 —— 那只是自己看得到的本地欄位。
    // 別人的 /versions 是靠 BCEMsg 廣播（features/hello.js）才填得到 FBCOtherAddons，
    // 所以清單有變動時要重新打一次招呼，格式與 WCE 相同，兩邊互通。
    setInterval(() => {
        try {
            if (!getFeature('shareAddons')) return;
            if (!(typeof ServerIsConnected !== 'undefined' && ServerIsConnected && ServerPlayerIsInChatRoom())) return;
            const loaded = window.bcModSdk?.getModsInfo?.() ?? [];
            if (JSON.stringify(loaded) === JSON.stringify(Player.FBCOtherAddons)) return;
            Player.FBCOtherAddons = loaded;
            sendHello(null, false);
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
