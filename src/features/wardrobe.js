// ════════════════════════════════════════════════════════════════════════════
// 衣櫃
//   extendedWardrobe    拓展衣櫃到 96 格（移植 WCE extendedWardrobe.ts）
//   privateWardrobe     用角色預覽取代衣櫃清單（移植 WCE privateWardrobe.js）
//   confirmWardrobeSave 覆蓋既有服裝前先確認
//
// 與 WCE 資料互通：額外的衣櫃格存在 Player.ExtensionSettings.FBCWardrobe
// （與 WCE 同一個鍵、同樣是 LZString UTF16），裝過 WCE 的帳號直接讀得到既有資料。
//
// 註：WCE 的 localWardrobe（+288 格，存 IndexedDB）不在規格內，未移植。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../core/constants.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const DEFAULT_WARDROBE_SIZE = 24;
const EXPANDED_WARDROBE_SIZE = 96;
const WARDROBE_KEY = 'FBCWardrobe';      // 與 WCE 相同（勿改，否則資料不互通）

let extendedLoaded = false;
let inCustomWardrobe = false;
let targetCharacter = null;
let appearanceBackup = null;
let excludeBodyparts = false;

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'wardrobe hook 未掛上:', name, e?.message ?? e); }
}

const parseJSON = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const isWardrobe = (w) => Array.isArray(w) && w.every(o => o === null || Array.isArray(o));
const isCharacter = (c) => !!c && typeof c === 'object' && typeof c.MemberNumber !== 'undefined';

/** 舊格式 Property.Type → TypeRecord（同 WCE，避免舊存檔載入後外觀跑掉）。 */
function sanitizeBundles(list) {
    if (!Array.isArray(list)) return list;
    return list.map(b => {
        if (typeof b?.Property?.Type === 'string' && !CommonIsObject(b.Property?.TypeRecord)) {
            const asset = AssetGet('Female3DCG', b.Group, b.Name);
            if (asset) b.Property.TypeRecord = ExtendedItemTypeToRecord(asset, b.Property.Type);
        }
        return b;
    });
}

// ───────────────────────── 拓展衣櫃 ─────────────────────────
export async function loadExtendedWardrobe(wardrobe) {
    if (!getFeature('extendedWardrobe')) return wardrobe;

    const wData = Player.ExtensionSettings?.[WARDROBE_KEY];
    WardrobeSize = EXPANDED_WARDROBE_SIZE;
    WardrobeFixLength();

    if (!wData) {
        // 沒有既有資料：可能是第一次啟用，也可能是伺服器暫時讀不到。
        // 直接建立空衣櫃會覆蓋掉雲端既有資料，所以先問過再說（同 WCE）。
        if (typeof FUSAM === 'object' && FUSAM?.modals) {
            const [answ] = await FUSAM.modals.openAsync({
                prompt: T('wardrobe_new_prompt'),
                buttons: { cancel: T('wardrobe_cancel'), submit: T('wardrobe_ok') },
            });
            if (answ === 'submit') extendedLoaded = true;
        }
        return wardrobe;
    }

    try {
        const extra = parseJSON(LZString.decompressFromUTF16(wData));
        if (isWardrobe(extra)) {
            for (let i = DEFAULT_WARDROBE_SIZE; i < EXPANDED_WARDROBE_SIZE; i++) {
                const idx = i - DEFAULT_WARDROBE_SIZE;
                if (idx >= extra.length) break;
                wardrobe[i] = sanitizeBundles(extra[idx]);
            }
            extendedLoaded = true;
        }
    } catch (e) {
        console.error(LOG, '拓展衣櫃載入失敗（原始資料已保留，未覆寫）:', e, wData);
    }
    return wardrobe;
}

// ───────────────────────── 角色預覽衣櫃 ─────────────────────────
const targetIsPlayer = () =>
    (inCustomWardrobe && targetCharacter?.IsPlayer()) || CharacterAppearanceSelection?.IsPlayer();

let installed = false;

export function installWardrobe() {
    if (installed) return;
    installed = true;

    // ── 拓展衣櫃：存檔時把 24 格之後的內容抽出來另存 ──
    hook('CharacterCompressWardrobe', 100, (args, next) => {
        let [wardrobe] = args;
        try {
            if (isWardrobe(wardrobe)) {
                const extra = wardrobe.slice(DEFAULT_WARDROBE_SIZE, EXPANDED_WARDROBE_SIZE);
                if (extra.length > 0 && extendedLoaded) {
                    Player.ExtensionSettings[WARDROBE_KEY] = LZString.compressToUTF16(JSON.stringify(extra));
                    wardrobe = wardrobe.slice(0, DEFAULT_WARDROBE_SIZE);   // 前 24 格才走 BC 原本的存檔
                    ServerPlayerExtensionSettingsSync(WARDROBE_KEY);
                }
            }
        } catch (e) { console.warn(LOG, '拓展衣櫃存檔失敗:', e); }
        return next([wardrobe]);
    });

    // ── 角色預覽衣櫃：把 Appearance 的衣櫃導向 Wardrobe 畫面 ──
    hook('CharacterAppearanceWardrobeLoad', 20, (args, next) => {
        const [C] = args;
        if (getFeature('privateWardrobe') && CurrentScreen === 'Appearance') {
            inCustomWardrobe = true;
            targetCharacter = isCharacter(C) ? C : CharacterGetCurrent();
            CommonSetScreen('Character', 'Wardrobe');
            return null;
        }
        return next(args);
    });

    hook('WardrobeLoad', 10, (args, next) => { appearanceBackup = CharacterAppearanceBackup; return next(args); });
    hook('AppearanceLoad', 10, (args, next) => {
        const ret = next(args);
        if (inCustomWardrobe) CharacterAppearanceBackup = appearanceBackup;
        return ret;
    });

    // 「載入時不含身體部位」的勾選框
    hook('AppearanceRun', 10, (args, next) => {
        if (CharacterAppearanceMode === 'Wardrobe' && targetIsPlayer()) {
            DrawCheckbox(1300, 350, 64, 64, '', excludeBodyparts, false, 'white');
            DrawTextFit(T('wardrobe_no_body'), 1374, 380, 630, 'white');
        }
        return next(args);
    });
    hook('AppearanceClick', 5, (args, next) => {
        if (CharacterAppearanceMode === 'Wardrobe' && MouseIn(1300, 350, 64, 64) && targetIsPlayer()) {
            excludeBodyparts = !excludeBodyparts;
            return null;
        }
        return next(args);
    });

    // 繪製衣櫃時暫時把 Player 換成目標角色，讓預覽畫的是對方
    hook('WardrobeRun', 10, (args, next) => {
        const playerBackup = Player;
        if (inCustomWardrobe && targetCharacter) {
            Player = targetCharacter;
            Player.VisualSettings = { ForceFullHeight: false };
            // 其他插件（echo-clothing-ext）缺少 null 檢查，補上 Canvas 避免它爆掉
            Player.Canvas = (CharacterAppearanceSelection ?? playerBackup).Canvas;
            Player.CanvasBlink = (CharacterAppearanceSelection ?? playerBackup).CanvasBlink;
        }
        const ret = next(args);
        if (inCustomWardrobe) Player = playerBackup;

        DrawText(`${T('wardrobe_page')}: ${((WardrobeOffset / 12) | 0) + 1}/${WardrobeSize / 12}`, 300, 35, 'White');
        DrawCheckbox(10, 74, 64, 64, '', excludeBodyparts, false, 'white');
        DrawTextFit(T('wardrobe_exclude_body'), 84, 106, 300, 'white');
        return ret;
    });

    hook('WardrobeClick', 5, (args, next) => {
        if (MouseIn(10, 74, 64, 64)) { excludeBodyparts = !excludeBodyparts; return null; }
        const ret = next(args);
        // 翻到還沒載入的頁時補載入角色預覽
        if (getFeature('privateWardrobe') && WardrobeOffset >= WardrobeCharacter.length
            && (MouseIn(415, 25, 60, 60) || MouseIn(1000, 25, 60, 60))) {
            WardrobeLoadCharacters(false);
        }
        return ret;
    });

    hook('WardrobeExit', 20, (args, next) => {
        if (!inCustomWardrobe) return next(args);
        CommonSetScreen('Character', 'Appearance');
        inCustomWardrobe = false;
        return null;
    });

    hook('WardrobeFastLoad', 20, (args, next) => {
        let [C] = args;
        const base = C?.Appearance?.filter(a => a.Asset.Group.IsDefault && !a.Asset.Group.Clothing) ?? [];
        if (inCustomWardrobe && isCharacter(C) && C.IsPlayer() && targetCharacter) {
            args[0] = targetCharacter; C = targetCharacter; args[2] = false;
        }
        const ret = next(args);
        if (excludeBodyparts && C) {
            C.Appearance = [...base, ...C.Appearance.filter(a => !a.Asset.Group.IsDefault || a.Asset.Group.Clothing)];
            CharacterLoadCanvas(C);
        }
        return ret;
    });

    // ── 覆蓋確認 ──
    hook('WardrobeFastSave', 20, (args, next) => {
        const [C] = args;
        if (inCustomWardrobe && isCharacter(C) && C.IsPlayer() && targetCharacter) args[0] = targetCharacter;
        // 該格已有內容（以 Pronouns 判斷存過檔）才問，空格不會被打擾
        if (getFeature('confirmWardrobeSave') && Player.Wardrobe?.length > args[1]
            && Player.Wardrobe[args[1]]?.some(a => a.Group === 'Pronouns')) {
            if (!window.confirm(T('wardrobe_override_confirm'))) return null;
        }
        return next(args);
    });

    // 在自訂衣櫃裡仍視為在聊天室（否則 BC 會誤判而中斷）
    hook('ServerPlayerIsInChatRoom', 10, (args, next) =>
        (inCustomWardrobe && CharacterAppearanceReturnScreen?.[1] === 'ChatRoom') || next(args));

    document.addEventListener('keydown', (e) => {
        if (!getFeature('privateWardrobe')) return;
        if (e.key === 'Escape' && inCustomWardrobe) { WardrobeExit(); e.stopPropagation(); e.preventDefault(); }
    }, true);

    // 拓展衣櫃：啟動時套用一次，並在設定被切換時即時套用。
    // （不能只在 install 時判斷一次 —— 這個設定預設是關的，那樣使用者打開後永遠不會生效）
    (function wait(n = 240) {
        if (!Player?.Wardrobe) {
            if (n <= 0) return;
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        applyExtendedWardrobe();
    })();

    window.addEventListener(SETTING_CHANGED_EVENT, (e) => {
        if (e.detail?.key === 'extendedWardrobe') applyExtendedWardrobe();
    });
}

/** 依目前設定套用/還原拓展衣櫃格數。可重複呼叫。 */
export function applyExtendedWardrobe() {
    try {
        if (!Player?.Wardrobe) return;
        if (getFeature('extendedWardrobe')) {
            loadExtendedWardrobe(Player.Wardrobe)
                .then(w => CharacterCompressWardrobe(w))
                .catch(e => console.warn(LOG, '拓展衣櫃初始化失敗:', e));
        } else {
            // 關閉 → 還原成 BC 預設的 24 格
            WardrobeSize = DEFAULT_WARDROBE_SIZE;
            WardrobeFixLength();
            CharacterAppearanceWardrobeOffset = 0;
            extendedLoaded = false;
        }
    } catch (e) { console.warn(LOG, '套用拓展衣櫃失敗:', e); }
}
