// ════════════════════════════════════════════════════════════════════════════
// 自動慾望表情（autoArousalExpression）＋ 活動表示（activityExpressions）
// 移植自 WCE automaticExpressions.js（資料表見 expressions-data.js）
//
// 依需求簡化：WCE 原本有 animationEngine 總開關，這裡砍掉 —— 引擎內建，
// 只要上述兩項任一啟用就運作，各自控制自己的事件類型（見 pushEvent）。
// 未移植：/r、/anim、/pose 指令（依需求排除）。
//
// 機制：
//   • 所有表情/姿勢變化都進一個佇列，每筆有 優先權 + 持續時間
//   • 每 250ms 掃佇列算出「此刻該是什麼表情/姿勢」，比對目前狀態後才送出變更
//   • 玩家手動改的表情會記成 MANUAL_OVERRIDE 事件，不會被自動表情蓋掉
//   • 姿勢與表情綁在一起（活動事件可同時帶 Poses），故姿勢引擎一併移植
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { ArousalExpressionStages, EventExpressions, ActivityTriggers } from './expressions-data.js';

const LOG = '🐈‍⬛ [LCE]';

const AROUSAL_EVT = 'AutomatedByArousal';
const DEFAULT_EVT = 'DEFAULT';
const GAME_TIMED_EVT = 'GameTimer';
const MANUAL_EVT = 'ManualOverride';
const POST_ORGASM_EVT = 'PostOrgasm';

const MODIFIER_MAP = Object.freeze({ Blush: [null, 'Low', 'Medium', 'High', 'VeryHigh', 'Extreme'] });
const FACE_COMPONENTS = ['Eyes', 'Eyes2', 'Eyebrows', 'Mouth', 'Fluids', 'Emoticon', 'Blush', 'Pussy'];
const POSE_CATEGORIES = {
    BodyFull: { Conflicts: ['BodyUpper', 'BodyLower', 'BodyAddon'] },
    BodyUpper: { Conflicts: ['BodyFull'] },
    BodyLower: { Conflicts: ['BodyFull', 'BodyAddon'] },
};
const DIR = { None: 0, Down: 1, Up: 2 };

const queue = [];
const manualComponents = {};
let lastUniqueId = 0;
let lastOrgasm = 0, orgasmCount = 0, wasDefault = false;
let PreviousArousal = null;
let PreviousDirection = DIR.Up;

// ───────────────────────── 小工具 ─────────────────────────
const newUniqueId = () => (lastUniqueId = (lastUniqueId + 1) % (Number.MAX_SAFE_INTEGER - 1));
const deepCopy = (o) => { try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); } };
const isString = (s) => typeof s === 'string';
const isCharacter = (c) => !!c && typeof c === 'object' && typeof c.MemberNumber !== 'undefined';
const mustNum = (v, d = 0) => (typeof v === 'number' && !isNaN(v) ? v : d);

/** 引擎是否運作：兩項功能任一啟用即可（取代 WCE 的 animationEngine 總開關）。 */
const engineOn = () => !!getFeature('autoArousalExpression') || !!getFeature('activityExpressions');

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'expressions hook 未掛上:', name, e?.message ?? e); }
}

/** 取得某部位目前的表情。 */
function expression(t) {
    const p = Player.Appearance.find(a => a.Asset.Group.Name === t)?.Property ?? null;
    return [p?.Expression || null, !p?.RemoveTimer];
}

function setExpression(t, n, color) {
    if (!n) n = null;
    for (const a of Player.Appearance) {
        if (a.Asset.Group.Name !== t) continue;
        if (!a.Property) a.Property = {};
        a.Property.Expression = n;
        if (color) a.Color = color;
        break;
    }
}

const getPoseCategory = (pose) => PoseFemale3DCG.find(a => a.Name === pose)?.Category;
const hasConflicts = (pose) => isString(pose) && pose in POSE_CATEGORIES;
const isStringOrStringArray = (v) => isString(v) || (Array.isArray(v) && v.every(isString));

/** 伺服器同步回來的姿勢 → 套進佇列（清掉舊的手動姿勢再重設）。 */
function setPoses(poses) {
    poses = poses.filter(p => p).map(p => p.toLowerCase());
    queue.forEach(e => {
        if (e.Type === MANUAL_EVT) {
            e.Poses = [];
        } else if (e.Poses?.length > 0) {
            e.Poses.forEach(p => {
                if (p.Pose.length === 0) return;
                if (typeof p.Pose[0] === 'string') return;
                p.Pose = p.Pose.filter(pp => !!getPoseCategory(pp));
            });
        }
    });
    const poseNames = PoseFemale3DCG.filter(p => poses.includes(p.Name.toLowerCase())).map(p => p.Name);
    for (const poseName of poseNames) PoseSetActive(Player, poseName, false);
}

/** BCX 規則查詢（沒裝 BCX 就當作沒有規則）。 */
function bcxRule(name) {
    try { return window.bcx?.getRuleState?.(name) ?? null; } catch { return null; }
}

// ───────────────────────── 佇列 ─────────────────────────
export function pushEvent(evt) {
    if (!evt) return;
    // 依事件類型分別由兩個設定控制（取代 WCE 的總開關）
    switch (evt.Type) {
        case AROUSAL_EVT:
        case POST_ORGASM_EVT:
            if (!getFeature('autoArousalExpression')) return;
            break;
        case MANUAL_EVT:
            break;   // 手動覆寫一律接受
        default:
            if (!getFeature('activityExpressions')) return;
    }

    const time = Date.now();
    const event = deepCopy(evt);
    event.At = time;
    event.Until = time + event.Duration;
    event.Id = newUniqueId();
    if (typeof event.Priority !== 'number') event.Priority = 1;

    if (event.Expression) {
        for (const t of Object.values(event.Expression)) {
            for (const exp of t) {
                exp.Id = newUniqueId();
                if (typeof exp.Priority !== 'number') exp.Priority = 1;
                if (typeof exp.Duration !== 'number') exp.Duration = event.Duration;
            }
        }
    }
    if (event.Poses) {
        for (const p of event.Poses) {
            p.Id = newUniqueId();
            if (typeof p.Priority !== 'number') p.Priority = 1;
        }
    }
    queue.push(event);
}

function resetExpressionQueue(types, skippedTypes = []) {
    delete Player.ExpressionQueue;
    queue.push(...queue.splice(0).map(e => {
        if (types.includes(e.Type) || (e.Duration <= 0 && e.Type !== AROUSAL_EVT && !skippedTypes.includes(e.Type))) {
            delete e.Expression;
        }
        return e;
    }));
    if (types.includes(MANUAL_EVT)) {
        for (const k of Object.keys(manualComponents)) delete manualComponents[k];
    } else {
        pushEvent({
            Type: MANUAL_EVT, Duration: -1,
            Expression: Object.entries(manualComponents).reduce((a, [k, v]) => { a[k] = [{ Expression: v }]; return a; }, {}),
        });
    }
}

// ───────────────────────── 活動觸發 ─────────────────────────
const dictHasPlayerTarget = (dict) =>
    dict?.some(t => t && 'TargetCharacter' in t && t.TargetCharacter === Player.MemberNumber) || false;

/** 收到聊天/活動訊息 → 比對觸發表 → 推送對應表情事件。 */
function handleChatMessage(data) {
    if (!getFeature('activityExpressions')) return;
    activityTriggers:
    for (const trigger of ActivityTriggers.filter(t => t.Type === data.Type)) {
        for (const matcher of trigger.Matchers) {
            if (!matcher.Tester.test(data.Content)) continue;
            if (matcher.Criteria) {
                if (matcher.Criteria.SenderIsPlayer && data.Sender !== Player.MemberNumber) continue;
                if (matcher.Criteria.TargetIsPlayer && !dictHasPlayerTarget(data.Dictionary)) continue;
                if (matcher.Criteria.DictionaryMatchers
                    && !matcher.Criteria.DictionaryMatchers.some(m => data.Dictionary?.find(t => Object.keys(m).every(k => m[k] === t[k])))) continue;
                pushEvent(EventExpressions[trigger.Event]);
            } else if (data.Sender === Player.MemberNumber || dictHasPlayerTarget(data.Dictionary)) {
                pushEvent(EventExpressions[trigger.Event]);
                break activityTriggers;
            }
        }
    }
}

// ───────────────────────── 主引擎 ─────────────────────────
function customArousalExpression() {
    if (!engineOn() || !Player?.AppearanceLayers || !Player.ArousalSettings) return;
    if (!PreviousArousal) PreviousArousal = { ...Player.ArousalSettings };

    // 我們自己管理計時，清掉 BC 的移除計時器
    Player.Appearance
        .filter(a => FACE_COMPONENTS.includes(a.Asset.Group.Name) && a.Property?.RemoveTimer)
        .forEach(a => { delete a.Property.RemoveTimer; });

    Player.ArousalSettings.AffectExpression = false;   // 取代 BC 原生的慾望表情

    const oCount = Player.ArousalSettings.OrgasmCount ?? 0;
    if (orgasmCount < oCount) orgasmCount = oCount;
    else if (orgasmCount > oCount) { Player.ArousalSettings.OrgasmCount = orgasmCount; ActivityChatRoomArousalSync(Player); }

    // 臉部完全恢復預設時，重設佇列
    let isDefault = true;
    for (const t of FACE_COMPONENTS) if (expression(t)[0]) isDefault = false;
    if (isDefault) {
        PreviousArousal.Progress = 0;
        PreviousDirection = DIR.Up;
        if (!wasDefault) {
            for (const q of queue) { if (q.Type !== AROUSAL_EVT) q.Expression = {}; }
        }
        wasDefault = true;
    } else wasDefault = false;

    const arousal = Player.ArousalSettings.Progress;
    let direction = PreviousDirection;
    if (arousal < PreviousArousal.Progress) direction = DIR.Down;
    else if (arousal > PreviousArousal.Progress) direction = DIR.Up;
    PreviousDirection = direction;

    /** 高潮後短時間內把表情往上拉（最多拉到慾望 90 的表情）。 */
    function lastOrgasmAdjustment() {
        const maxArousal = 90, maxBoost = 30;
        const orgasms = Player.ArousalSettings?.OrgasmCount || 0;
        const boostDuration = Math.min(300, 60 + orgasms * 5);
        const since = ((Date.now() - lastOrgasm) / 10000) | 0;
        if (since > boostDuration) return 0;
        return Math.min(Math.max(0, maxArousal - arousal), (maxBoost * (boostDuration - since)) / boostDuration);
    }

    // 高潮 → 推送 PostOrgasm 事件
    const ORGASM_RECOVERY = 2;
    if (PreviousArousal.OrgasmStage !== ORGASM_RECOVERY && Player.ArousalSettings.OrgasmStage === ORGASM_RECOVERY
        && queue.filter(a => a.Type === POST_ORGASM_EVT).length === 0) {
        pushEvent(EventExpressions.PostOrgasm);
        lastOrgasm = Date.now();
    }

    const desiredExpression = {};
    let desiredPose = {};
    const nextExpression = {};

    const trySetNext = (e, exp, next, t) => {
        const priority = exp.Priority || next.Priority || 0;
        if (!nextExpression[t] || (nextExpression[t].Priority ?? 0) <= priority) {
            nextExpression[t] = { Id: exp.Id, Expression: e, Duration: exp.Duration, Priority: priority, Color: exp.Color };
        }
    };

    // 掃佇列，算出此刻每個部位該是什麼
    for (let j = 0; j < queue.length; j++) {
        const next = queue[j];
        const until = next.Until ?? 0, at = next.At ?? 0;
        let active = false;

        if (until > Date.now() || until - at < 0) {
            const expr = next.Expression ?? {};
            for (const t of Object.keys(expr)) {
                let durationNow = Date.now() - at;
                for (let i = 0; i < expr[t].length; i++) {
                    const exp = expr[t][i];
                    durationNow -= exp.Duration;
                    if (durationNow >= 0 && exp.Duration >= 0) continue;
                    active = true;
                    if (!exp.Skip) {
                        if (exp.ExpressionModifier && t in MODIFIER_MAP) {
                            const [current] = expression(t);
                            if (!exp.Applied) {
                                let idx = MODIFIER_MAP[t].indexOf(current) + exp.ExpressionModifier;
                                idx = Math.max(0, Math.min(MODIFIER_MAP[t].length - 1, idx));
                                trySetNext(MODIFIER_MAP[t][idx], exp, next, t);
                                queue[j].Expression[t][i].Applied = true;
                            } else {
                                trySetNext(current, exp, next, t);   // 佔住優先權但不改變
                            }
                        } else {
                            trySetNext(exp.Expression ?? null, exp, next, t);
                        }
                    }
                    break;
                }
            }

            if (next.Poses?.length) {
                let durationNow = Date.now() - at;
                for (const pose of next.Poses) {
                    durationNow -= pose.Duration;
                    if (durationNow >= 0 && pose.Duration >= 0) continue;
                    active = true;
                    for (const p of pose.Pose) {
                        const priority = pose.Priority || next.Priority || 0;
                        const category = getPoseCategory(p);
                        if (!category) continue;
                        if (!pose.Id) pose.Id = newUniqueId();
                        if (!desiredPose[category] || desiredPose[category].Priority <= priority) {
                            desiredPose[category] = { Id: pose.Id, Pose: p, Category: category, Duration: pose.Duration, Priority: priority, Type: next.Type };
                        }
                    }
                    break;
                }
            }
        }

        if (!active) {
            const last = queue.splice(j, 1);
            j--;
            if (!getFeature('autoArousalExpression') && last.length > 0 && last[0].Expression) {
                for (const t of Object.keys(last[0].Expression)) {
                    trySetNext(null, { Duration: -1 }, { Priority: 0, Type: DEFAULT_EVT, Duration: 500 }, t);
                }
            }
        }
    }

    // 回收已被更高優先權取代的項目
    for (let j = 0; j < queue.length; j++) {
        const qExpr = queue[j].Expression;
        const qPoses = queue[j].Poses;
        if (qExpr) {
            for (const t of Object.keys(qExpr)) {
                if (!nextExpression[t] || nextExpression[t].Duration > 0) continue;
                const nextId = mustNum(nextExpression[t].Id), nextPriority = mustNum(nextExpression[t].Priority, 0);
                for (let i = 0; i < qExpr[t].length; i++) {
                    const exp = qExpr[t][i];
                    if (exp.Duration < 0 && (mustNum(exp.Id) < nextId || mustNum(exp.Priority, 0) < nextPriority)) {
                        qExpr[t].splice(i, 1); i--;
                    }
                }
                if (qExpr[t].length === 0) delete qExpr[t];
            }
        }
        if (qPoses) {
            for (let k = 0; k < qPoses.length; k++) {
                const pose = qPoses[k];
                const newerInfinite = pose.Pose.every(p => {
                    const c = getPoseCategory(p);
                    return !!c && desiredPose[c]?.Duration < 0 && desiredPose[c]?.Id > mustNum(pose.Id)
                        && (desiredPose[c]?.Type === MANUAL_EVT || queue[j].Type !== MANUAL_EVT);
                });
                if (pose.Duration < 0 && newerInfinite) { qPoses.splice(k, 1); k--; }
            }
        }
        if (Object.keys(queue[j].Expression || {}).length === 0 && queue[j].Poses?.length === 0) { queue.splice(j, 1); j--; }
    }

    // 清掉不再需要的姿勢
    let needsRefresh = false;
    let poseUpdate = false;
    if (Player.ActivePose) {
        for (let i = 0; i < Player.ActivePose.length; i++) {
            const pose = Player.ActivePose[i];
            const p = PoseFemale3DCG.find(pp => pp.Name === pose);
            if (!p?.Category && Object.values(desiredPose).every(v => v.Pose !== pose)) {
                poseUpdate = [...Player.ActivePose];
                poseUpdate.splice(i, 1); i--;
                needsRefresh = true;
            }
        }
    }

    // 慾望 → 表情分級
    outer:
    for (const t of Object.keys(ArousalExpressionStages)) {
        const [exp] = expression(t);
        let chosen = null, chose = false;
        for (const face of ArousalExpressionStages[t]) {
            const limit = face.Limit - (direction === DIR.Up ? 0 : 1);
            if (arousal + lastOrgasmAdjustment() >= limit) {
                if (face.Expression !== exp) { chosen = face.Expression; chose = true; break; }
                continue outer;
            }
        }
        if (chose) {
            pushEvent({ Type: AROUSAL_EVT, Duration: -1, Priority: 0, Expression: { [t]: [{ Expression: chosen, Duration: -1, Priority: 0 }] } });
        }
    }

    for (const t of FACE_COMPONENTS) {
        const [exp] = expression(t);
        const nextExp = nextExpression[t] || { Duration: -1, Expression: null };
        if (nextExp.Expression !== exp && typeof nextExp.Expression !== 'undefined') desiredExpression[t] = { ...nextExp };
    }

    // 套用表情
    if (Object.keys(desiredExpression).length > 0) {
        let refreshScreen = false;
        for (const t of Object.keys(desiredExpression)) {
            if (bcxRule('block_changing_emoticon')?.isEnforced && t === 'Emoticon') continue;
            setExpression(t, desiredExpression[t].Expression ?? null, desiredExpression[t].Color);
            ServerSend('ChatRoomCharacterExpressionUpdate', {
                Name: desiredExpression[t].Expression ?? null, Group: t,
                Appearance: ServerAppearanceBundle(Player.Appearance),
            });
            if (desiredExpression[t].Duration < 0 && desiredExpression[t].Expression !== 'Closed') {
                refreshScreen = true;
                Player.ActiveExpression?.setWithoutReload?.(t, desiredExpression[t].Expression);
            }
        }
        if (refreshScreen && DialogSelfMenuSelected === 'Expression' && DialogSelfMenuMapping.Expression.C.IsPlayer()) {
            DialogSelfMenuMapping.Expression.Reload();
        }
        needsRefresh = true;
    }

    // 姿勢衝突解析（例如全身姿勢會蓋掉上下半身）
    function resolvePoseConflicts() {
        const vals = Object.values(desiredPose);
        if (!vals.length) return 0;
        const maxPriority = Math.max(...vals.map(p => p.Priority));
        const maxPriorityPoses = Object.entries(desiredPose).filter(p => p[1].Priority === maxPriority);
        if (maxPriorityPoses.length === 0) return 0;
        let maxPriorityPose;
        if (maxPriorityPoses.length > 1) {
            const maxId = Math.max(...maxPriorityPoses.map(p => p[1].Id));
            [[maxPriorityPose]] = maxPriorityPoses.filter(p => p[1].Id === maxId);
        } else {
            [[maxPriorityPose]] = maxPriorityPoses;
        }
        let deleted = 0;
        if (hasConflicts(maxPriorityPose)) {
            for (const conflict of (POSE_CATEGORIES[maxPriorityPose].Conflicts || []).filter(c => c in desiredPose)) {
                delete desiredPose[conflict]; deleted++;
            }
        }
        return deleted;
    }
    while (resolvePoseConflicts() > 0) { /* 反覆解到沒有衝突 */ }

    if (Object.keys(desiredPose).length === 0) {
        desiredPose = {
            BodyUpper: { Pose: 'BaseUpper', Duration: -1, Id: newUniqueId(), Priority: 0, Type: DEFAULT_EVT },
            BodyLower: { Pose: 'BaseLower', Duration: -1, Id: newUniqueId(), Priority: 0, Type: DEFAULT_EVT },
        };
    }
    const newPose = Object.values(desiredPose).map(p => p.Pose);
    if (JSON.stringify(Player.ActivePose) !== JSON.stringify(newPose)) { poseUpdate = newPose; needsRefresh = true; }

    if (poseUpdate) {
        Player.ActivePose = poseUpdate;
        ServerSend('ChatRoomCharacterPoseUpdate', { Pose: poseUpdate });
        if (DialogSelfMenuSelected === 'Pose' && DialogSelfMenuMapping.Pose.C.IsPlayer()) DialogSelfMenuMapping.Pose.Reload();
    }

    if (needsRefresh) CharacterRefresh(Player, false, false);
    PreviousArousal = { ...Player.ArousalSettings };
}

let installed = false;
let engineStarted = false;

/** 供 /lcedebug 檢查引擎是否已經啟動。 */
export const isExpressionEngineStarted = () => engineStarted;

export function installExpressions() {
    if (installed) return;
    installed = true;

    // 等到第一次進聊天室才啟動。不設次數上限 —— 使用者可能登入後過很久才進房，
    // 一旦放棄就再也不會綁 socket，整個引擎會靜靜地失效（同 WCE 的 waitFor，無逾時）。
    (function wait() {
        if (typeof CurrentScreen === 'undefined' || CurrentScreen !== 'ChatRoom' || !Player?.ArousalSettings) {
            setTimeout(wait, 500);
            return;
        }
        engineStarted = true;
        console.info(LOG, '表情引擎已啟動');
        PreviousArousal = { ...Player.ArousalSettings };

        // 初始化時把目前臉部記成手動覆寫，避免一開場就被自動表情蓋掉
        pushEvent({
            Type: MANUAL_EVT, Duration: -1,
            Expression: FACE_COMPONENTS
                .map(t => [t, expression(t)[0]])
                .filter(v => v[1] !== null)
                .reduce((a, [k, v]) => { a[k] = [{ Expression: v }]; return a; }, {}),
        });

        // socket 監聽（重連後要重掛）：活動觸發 + 伺服器同步回來的姿勢
        const bind = () => {
            try {
                ServerSocket?.on('ChatRoomMessage', handleChatMessage);
                ServerSocket?.on('ChatRoomSyncPose', (data) => {
                    if (!engineOn() || !data || !Array.isArray(data.Pose)) return;
                    if (data.MemberNumber === Player.MemberNumber) setPoses(data.Pose);
                });
                ServerSocket?.on('ChatRoomSyncSingle', (data) => {
                    if (!engineOn() || !data) return;
                    if (data.Character?.MemberNumber === Player.MemberNumber) setPoses(data.Character.ActivePose ?? []);
                });
            } catch { /* ignore */ }
        };
        bind();
        hook('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; });

        resetExpressionQueue([MANUAL_EVT, GAME_TIMED_EVT]);
        setInterval(() => { try { customArousalExpression(); } catch (e) { console.warn(LOG, 'expressions:', e); } }, 250);
    })();

    // 玩家手動改姿勢 → 記成手動覆寫。
    // 少了這段，引擎每 250ms 會把 ActivePose 打回預設的 BaseUpper/BaseLower，姿勢根本改不動。
    for (const poseFunc of ['CharacterSetActivePose', 'PoseSetActive']) {
        hook(poseFunc, 20, (args, next) => {
            const [C, Pose] = args;
            if (!isCharacter(C) || (!isStringOrStringArray(Pose) && Pose !== null) || !C.IsPlayer() || !engineOn()) {
                return next(args);
            }
            const p = !Pose || (Array.isArray(Pose) && Pose.every(pp => !pp)) ? ['BaseUpper', 'BaseLower'] : [Pose];
            pushEvent({ Type: MANUAL_EVT, Duration: -1, Poses: [{ Pose: p, Duration: -1 }] });
            return customArousalExpression();
        });
    }

    // 掙扎結束 → 清掉遊戲計時類表情
    hook('StruggleMinigameStop', 5, (args, next) => {
        if (engineOn()) {
            try { StruggleExpressionStore = undefined; } catch { /* ignore */ }
            resetExpressionQueue([GAME_TIMED_EVT], [MANUAL_EVT]);
        }
        return next(args);
    });

    // 玩家手動改表情 → 記成手動覆寫，之後不被自動表情蓋掉
    hook('CharacterSetFacialExpression', 20, (args, next) => {
        let [C, AssetGroup, Expression, Timer, Color] = args;
        if (!isCharacter(C) || !isString(AssetGroup) || (!isString(Expression) && Expression !== null)
            || !C.IsPlayer() || !engineOn()) {
            return next(args);
        }
        const duration = typeof Timer === 'number' && Timer > 0 ? Timer * 1000 : -1;
        const e = {};
        const types = AssetGroup === 'Eyes' ? ['Eyes', 'Eyes2'] : AssetGroup === 'Eyes1' ? ['Eyes'] : [AssetGroup];
        if (!Color || !CommonColorIsValid(Color)) Color = undefined;
        for (const t of types) {
            e[t] = [{ Expression, Duration: duration, Color }];
            if (duration < 0) manualComponents[t] = Expression;
        }
        pushEvent({ Type: MANUAL_EVT, Duration: duration, Expression: e });
        return customArousalExpression();
    });
}
