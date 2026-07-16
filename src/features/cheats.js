// ════════════════════════════════════════════════════════════════════════════
// 作弊與反作弊
//   lockpick                顯示翹鎖順序（依技能隨機揭示部分插銷）
//   autoStruggle            掙扎時自動增加進度（力量/柔軟/靈巧三種）
//   allowLayeringWhileBound 綑綁時仍可使用分層選單
//   uwall                   UWALL 反作弊（同步到 OnlineSharedSettings 供他人辨識）
//   allowIMBypassBCX        繞過 BCX 的 beep 限制（IM 送出時判斷）
//   antiCheatLevel(+Enabled)／antiCheatBlacklist —— 見下方說明
// 移植自 WCE lockpickHelp.js / autoStruggle.js / layeringMenu.ts / itemAntiCheat.js
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { lceChatNotify } from '../commands/commander.js';

const LOG = '🐈‍⬛ [LCE]';

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'cheats hook 未掛上:', name, e?.message ?? e); }
}

const deepCopy = (o) => { try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); } };
const mustNum = (v, d = 0) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);

/** 送出一則動作訊息（同 chat.js 的 sendActionText）。 */
function sendActionText(text) {
    if (!text || typeof ServerSend !== 'function') return;
    ServerSend('ChatRoomChat', {
        Content: 'CUSTOM_SYSTEM_ACTION',
        Type: 'Action',
        Dictionary: [{ Tag: 'MISSING TEXT IN "Interface.csv": CUSTOM_SYSTEM_ACTION', Text: text }],
    });
}

// ───────────────────────── 翹鎖提示 ─────────────────────────
/** 以插銷順序為種子的偽亂數：同一把鎖每次揭示的插銷固定，不能靠重開刷出更多提示。 */
function newRand(seed) {
    let s = seed;
    return () => { s = Math.sin(s) * 10000; return s - Math.floor(s); };
}

const PIN_SPACING = 100, PIN_WIDTH = 200, PIN_X = 1575, PIN_Y = 300;

function drawLockpickHints() {
    if (!getFeature('lockpick') || typeof StruggleLockPickOrder === 'undefined' || !StruggleLockPickOrder) return;
    const rand = newRand(parseInt(StruggleLockPickOrder.join(''), 10));
    const threshold = SkillGetWithRatio(Player, 'LockPicking') / 20;   // 技能越高揭示越多
    const hints = StruggleLockPickOrder.map(a => (rand() < threshold ? a : false));
    for (let p = 0; p < hints.length; p++) {
        if (hints[p] === false) continue;
        const xx = PIN_X - PIN_WIDTH / 2 + (0.5 - hints.length / 2 + p) * PIN_SPACING;
        DrawText(`${StruggleLockPickOrder.indexOf(p) + 1}`, xx, PIN_Y, 'blue');
    }
}

// ───────────────────────── 反作弊（移植自 WCE itemAntiCheat.js）─────────────────────────
// 與 WCE 的差異：WCE 是「布林 + 只豁免白名單」；本專案改成權限階梯。
// 把對方相對於玩家的關係換算成信任等級，設定值 = 「至少要到哪一級才豁免」。
//   僅黑名單(0) < 好友以上(1) < 白名單以上(2) < 戀人以上(3) < 主人(4) < 僅自己(5)
// 例：預設 whitelist(2) → 白名單/戀人/主人/自己都豁免，好友與陌生人仍受檢查。
const TRUST = { stranger: 0, friend: 1, whitelist: 2, lover: 3, owner: 4, self: 5 };
const LEVEL_THRESHOLD = {
    blacklist: 0,   // 只有黑名單不豁免（陌生人 stranger=0 也 >= 0，故豁免）
    friend:    1,
    whitelist: 2,
    lover:     3,
    owner:     4,
    self:      5,
};

/** 對方相對於玩家的信任等級；黑名單一律回 -1（永不豁免）。 */
function trustLevel(memberNumber) {
    if (memberNumber === Player?.MemberNumber) return TRUST.self;
    if (Player?.BlackList?.includes(memberNumber)) return -1;
    if (Player?.Ownership?.MemberNumber === memberNumber) return TRUST.owner;
    if (Player?.Lovership?.some(a => a.MemberNumber === memberNumber)) return TRUST.lover;
    if (Player?.WhiteList?.includes(memberNumber)) return TRUST.whitelist;
    if (Player?.FriendList?.includes(memberNumber)) return TRUST.friend;
    return TRUST.stranger;
}

const antiCheatOn = () => !!getFeature('antiCheatLevelEnabled');

/** 依設定的權限階梯判斷該來源是否豁免檢查。 */
function isExempt(memberNumber) {
    const need = LEVEL_THRESHOLD[getFeature('antiCheatLevel')] ?? LEVEL_THRESHOLD.whitelist;
    return trustLevel(memberNumber) >= need;
}

const sourceName = (C) => `${CharacterNickname(C)} (${C.MemberNumber ?? '-1'})`;

/** 鎖上的 LockMemberNumber 必須是下鎖者本人，否則是偽造。 */
function validateNewLockMemberNumber(srcC, newItem) {
    if (!newItem.Name || !newItem.Property?.LockedBy) return true;
    if (newItem.Property?.LockMemberNumber !== srcC.MemberNumber) {
        console.debug(LOG, '反作弊：鎖的成員編號不符', newItem.Property?.LockMemberNumber, '來源', srcC.MemberNumber);
        return false;
    }
    return true;
}

/** 比對單一物品的變更，回傳 { changed, prohibited }。 */
function validateSingleItemChange(srcC, oldItem, newItem, ignoreLocks, ignoreColors) {
    const changes = { changed: 0, prohibited: false };
    if (srcC.IsPlayer()) return changes;

    // 比對前先拿掉不該影響判斷的欄位（會隨時間/裝備自然變動的 metadata）
    function stripMeta(item) {
        if (!item) return item;
        const clone = deepCopy(item);
        if (!clone) return clone;
        if (clone.Property) {
            if (ignoreLocks) {
                delete clone.Property.LockMemberNumber;
                delete clone.Property.LockedBy;
                delete clone.Property.RemoveTimer;
                delete clone.Property.Effect;
            }
            delete clone.Property.BlinkState;
        }
        if (ignoreColors) delete clone.Color;
        return clone;
    }

    // 女主人鎖：非女主人／主人／戀人不得增減，也不得大幅改計時
    function validateMistressLocks() {
        const canBeMistress = (srcC?.Reputation?.find(a => a.Type === 'Dominant')?.Value ?? 0) >= 50
            || srcC.Title === 'Mistress';
        if (canBeMistress
            || srcC.MemberNumber === Player.Ownership?.MemberNumber
            || Player.Lovership?.some(a => a.MemberNumber === srcC.MemberNumber)) return;

        const M = ['MistressPadlock', 'MistressTimerPadlock'];
        for (const lock of M) {
            if (oldItem?.Property?.LockedBy === lock && newItem?.Property?.LockedBy !== lock) {
                console.debug(LOG, '反作弊：非女主人嘗試移除女主人鎖', sourceName(srcC));
                changes.prohibited = true;
            }
            if (oldItem?.Property?.LockedBy !== lock && newItem?.Property?.LockedBy === lock) {
                console.debug(LOG, '反作弊：非女主人嘗試加上女主人鎖', sourceName(srcC));
                changes.prohibited = true;
            }
        }
        // 公開入場最多只能改 30 分鐘，抓 31 分鐘為界
        if (oldItem?.Property?.LockedBy === 'MistressTimerPadlock'
            && Math.abs(mustNum(oldItem.Property?.RemoveTimer, Number.MAX_SAFE_INTEGER)
                - mustNum(newItem?.Property?.RemoveTimer)) > 31 * 60 * 1000) {
            console.debug(LOG, '反作弊：非女主人嘗試超額調整女主人鎖計時', sourceName(srcC));
            changes.prohibited = true;
        }
    }

    if (newItem && newItem.Property?.LockMemberNumber !== oldItem?.Property?.LockMemberNumber) {
        if (!validateNewLockMemberNumber(srcC, newItem)) changes.prohibited = true;
    }
    validateMistressLocks();

    newItem = stripMeta(newItem);
    oldItem = stripMeta(oldItem);
    if (JSON.stringify(newItem) !== JSON.stringify(oldItem)) changes.changed++;
    return changes;
}

/** 同一個人的公開提示 10 分鐘只送一次，避免洗版。 */
const noticesSent = new Map();

function revertChanges(srcC) {
    if (typeof srcC.MemberNumber !== 'number') return;
    const name = sourceName(srcC);
    console.debug(LOG, '反作弊：已拒絕來自', name, '的變更');
    lceChatNotify(T('ac_rejected').replace('$name', name).replace('$num', String(srcC.MemberNumber)));

    const last = noticesSent.get(srcC.MemberNumber) || 0;
    if (Date.now() - last > 1000 * 60 * 10) {
        noticesSent.set(srcC.MemberNumber, Date.now());
        sendActionText(T('ac_shield').replace('$player', CharacterNickname(Player)).replace('$name', name));
    }

    if (getFeature('antiCheatBlacklist')
        && !Player.WhiteList?.includes(srcC.MemberNumber)
        && !Player.BlackList?.includes(srcC.MemberNumber)) {
        ChatRoomListUpdate(Player.BlackList, true, srcC.MemberNumber);
        lceChatNotify(T('ac_blacklisted').replace('$name', name));
    }
    ChatRoomCharacterUpdate(Player);
}

/** 找出變更來源角色；不在房內就回 null（呼叫端會放行，不擋不明來源）。 */
const findSource = (num) =>
    ChatRoomCharacter?.find(a => a.MemberNumber === num) || (num === Player.MemberNumber ? Player : null);

function installAntiCheat() {
    // 單件物品同步
    hook('ChatRoomSyncItem', 10, (args, next) => {
        try {
            if (!antiCheatOn()) return next(args);
            const [data] = args;
            const item = data?.Item;
            if (item?.Target !== Player.MemberNumber) return next(args);
            if (isExempt(data.Source)) return next(args);

            const srcC = findSource(data.Source);
            if (!srcC) return next(args);

            // 未來派項圈/胸背帶本來就能整批改鎖/改色，這類變更不算作弊
            const ignoreLocks = Player.Appearance.some(a => a.Asset.Name === 'FuturisticCollar');
            const ignoreColors = Player.Appearance.some(a => a.Asset.Name === 'FuturisticHarness') || ignoreLocks;

            const oldItem = Player.Appearance.find(i => i.Asset.Group.Name === item.Group);
            const oldBundle = oldItem ? ServerAppearanceBundle([oldItem])[0] : null;
            if (validateSingleItemChange(srcC, oldBundle, item, ignoreLocks, ignoreColors).prohibited) {
                revertChanges(srcC);
                return null;
            }
        } catch (e) { console.warn(LOG, '反作弊（單件）錯誤，已放行:', e); }
        return next(args);
    });

    // 整體外觀同步：一次動超過 2 件就當作可疑
    hook('ChatRoomSyncSingle', 10, (args, next) => {
        try {
            if (!antiCheatOn()) return next(args);
            const [data] = args;
            if (!data?.Character || data.Character.MemberNumber !== Player.MemberNumber) return next(args);
            if (isExempt(data.SourceMemberNumber)) return next(args);

            const srcC = findSource(data.SourceMemberNumber);
            if (!srcC || srcC.IsPlayer()) return next(args);
            if (!data.Character.Appearance) return next(args);

            // 只比對 Item 類（衣物/髮型等不在反作弊範圍），並忽略純換色
            const toMap = (bundle) => bundle.reduce((prev, cur) => {
                cur = deepCopy(cur);
                delete cur.Color;
                prev.set(`${cur.Group}/${cur.Name}`, cur);
                return prev;
            }, new Map());

            const oldItems = toMap(ServerAppearanceBundle(
                Player.Appearance.filter(a => a.Asset.Group.Category === 'Item')));
            const newItems = toMap(data.Character.Appearance.filter(
                a => ServerBundledItemToAppearanceItem('Female3DCG', a)?.Asset.Group.Category === 'Item'));

            const has = (m, n) => Array.from(m.values()).some(i => i.Name === n);
            const ignoreLocks = has(oldItems, 'FuturisticCollar') && has(newItems, 'FuturisticCollar');
            const ignoreColors = (has(oldItems, 'FuturisticHarness') && has(newItems, 'FuturisticHarness')) || ignoreLocks;

            const acc = { new: 0, changed: 0, prohibited: false };
            for (const [key, newItem] of newItems) {
                if (!oldItems.has(key)) {
                    if (!validateNewLockMemberNumber(srcC, newItem)) acc.prohibited = true;
                    acc.new++;
                    continue;
                }
                const r = validateSingleItemChange(srcC, oldItems.get(key) ?? null, newItem, ignoreLocks, ignoreColors);
                acc.prohibited ||= r.prohibited;
                acc.changed += r.changed;
            }
            let removed = 0;
            for (const key of oldItems.keys()) if (!newItems.has(key)) removed++;

            if (acc.new + acc.changed + removed > 2 || acc.prohibited) {
                console.debug(LOG, '反作弊：整體變更觸發', srcC.MemberNumber, acc, '移除', removed);
                revertChanges(srcC);
                return null;
            }
        } catch (e) { console.warn(LOG, '反作弊（整體）錯誤，已放行:', e); }
        return next(args);
    });
}

let installed = false;

export function installCheats() {
    if (installed) return;
    installed = true;

    // 翹鎖提示
    hook('StruggleLockPickDraw', 10, (args, next) => {
        try { drawLockpickHints(); } catch (e) { console.warn(LOG, e); }
        return next(args);
    });
    // WCE 也會把 Draw 指回 hook 過的函式，確保小遊戲用到的是同一個
    try {
        if (typeof StruggleMinigames !== 'undefined' && StruggleMinigames?.LockPick) {
            StruggleMinigames.LockPick.Draw = StruggleLockPickDraw;
        }
    } catch { /* ignore */ }

    // 自動掙扎：柔軟度小遊戲直接判定通過
    hook('StruggleFlexibilityCheck', 20, (args, next) => {
        if (getFeature('autoStruggle') && StruggleProgressFlexCircles?.length > 0) {
            StruggleProgressFlexCircles.splice(0, 1);
            return true;
        }
        return next(args);
    });

    // 自動掙扎：力量/柔軟度持續推進
    setInterval(() => {
        try {
            if (!getFeature('autoStruggle')) return;
            if (typeof StruggleProgress !== 'number' || StruggleProgress < 0) return;
            if (StruggleProgressCurrentMinigame === 'Strength') StruggleStrengthProcess(false);
            else if (StruggleProgressCurrentMinigame === 'Flexibility' && StruggleProgressFlexCircles?.length > 0) {
                StruggleFlexibilityProcess(false);
            }
        } catch { /* ignore */ }
    }, 60);

    // 自動掙扎：靈巧度需要抓準時機（複製 BC StruggleDexterity 的判定）
    setInterval(() => {
        try {
            if (!getFeature('autoStruggle')) return;
            if (typeof StruggleProgress !== 'number' || StruggleProgress < 0) return;
            if (StruggleProgressCurrentMinigame !== 'Dexterity') return;
            const distMult = Math.max(-0.5, Math.min(1,
                (85 - Math.abs(StruggleProgressDexTarget - StruggleProgressDexCurrent)) / 75));
            if (distMult > 0.5) StruggleDexterityProcess();
        } catch { /* ignore */ }
    }, 0);

    // UWALL：把狀態同步到 OnlineSharedSettings，讓其他插件知道你開了反作弊
    hook('ServerPlayerSync', 0, (args, next) => {
        try {
            const on = !!getFeature('uwall');
            if (Player?.OnlineSharedSettings && Player.OnlineSharedSettings.Uwall !== on) {
                Player.OnlineSharedSettings.Uwall = on;
                ServerAccountUpdate.QueueData({ OnlineSharedSettings: Player.OnlineSharedSettings });
            }
        } catch { /* ignore */ }
        return next(args);
    });

    installAntiCheat();
}

/** 綑綁時是否允許使用分層選單（供 layering 相關流程查詢）。 */
export const layeringAllowedWhileBound = () => !!getFeature('allowLayeringWhileBound');

/** IM 是否可繞過 BCX beep 限制。 */
export const imBypassBCX = () => !!getFeature('allowIMBypassBCX');
