// ════════════════════════════════════════════════════════════════════════════
// 自動慾望表情（autoArousalExpression）＋ 活動表示（activityExpressions）
// 移植自 WCE automaticExpressions.js（資料表見 expressions-data.js）
//
// animationEngine 是總開關，且必須存在：引擎一旦運作就會接管整張臉 ——
// CharacterSetFacialExpression 被改導進佇列（鉤子不呼叫 next），BC 的函式本體
// 從此不再執行，連 BC 自己的表情面板都只能透過佇列生效。這種程度的接管必須由
// 使用者明示同意，故預設關閉；上述兩項功能只在它開啟時可用，各自控制自己的
// 事件類型（見 pushEvent）。
// （曾為「簡化」而砍掉此開關，導致只勾活動表示就整臉被鎖死，勿再移除。）
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

// 引擎的表情／姿勢鉤子專用優先權：務必排在所有模組之後。
//
// ModSDK 依優先權由大到小串接鉤子，而這些鉤子在引擎開啟時「不呼叫 next」——
// 排在我們後面的模組會一個都跑不到。其他模組正是靠掛在這些函式上做自己的事，
// 例如「服装拓展」把 Eyes 的表情鏡射到它自己新增的 左眼_Luzi / 右眼_Luzi 群組。
// WCE 用 OverrideBehaviour(10) 搶在最前面，實測 hookedByMods 為
// ['WCE', 'LSCG', '服装拓展'] —— 它把後兩者活活餓死，開了 animationEngine 後
// 模組的眼睛就不會動。這是 WCE 的缺陷，不要對齊它。
// 我們終止呼叫鏈，就必須讓所有人先跑完；負值確保排在最末端（BC 本體仍在我們之後）。
const ENGINE_HOOK_PRIORITY = -100;
// BC 內建的表情部位（＝WCE 的 faceComponents）。當保底用，實際清單見 faceComponents()。
const BASE_FACE_COMPONENTS = ['Eyes', 'Eyes2', 'Eyebrows', 'Mouth', 'Fluids', 'Emoticon', 'Blush', 'Pussy'];

/**
 * 本角色實際可用的表情部位 = 內建清單 ∪ 身上所有帶 AllowExpression 的群組。
 *
 * 這裡不能像 WCE 那樣寫死。BC 的表情面板是列出「所有帶 AllowExpression 的群組」，
 * 而其他模組會自己新增這種群組（例如 Luzi 的 左眼_Luzi / 右眼_Luzi，資產名「眼睛6」），
 * 面板點下去 BC 呼叫的就是 CharacterSetFacialExpression(C, "左眼_Luzi", ...)。
 * 引擎開著時我們的鉤子會攔下它且不呼叫 next，事件照樣進佇列 —— 但套用迴圈若只認寫死的
 * 8 個部位，這些群組就永遠寫不回去，表情進得去出不來，模組的眼睛被鎖死，
 * BC 內建的眼睛卻一切正常。（WCE 寫死同一份清單，此處是刻意的分歧，勿改回。）
 */
function faceComponents() {
    const found = new Set(BASE_FACE_COMPONENTS);
    for (const a of Player.Appearance ?? []) {
        const g = a.Asset?.Group;
        if (g?.AllowExpression?.length) found.add(g.Name);
    }
    return [...found];
}
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
let engineStarted = false;   // 進過聊天室、250ms 迴圈已在跑（engineOn 用）
let notifying = false;       // 引擎正在通知其他模組，此時鉤子必須放行（見 notifyMods）

// ───────────────────────── 小工具 ─────────────────────────
const newUniqueId = () => (lastUniqueId = (lastUniqueId + 1) % (Number.MAX_SAFE_INTEGER - 1));
const deepCopy = (o) => { try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); } };
const isString = (s) => typeof s === 'string';
const isCharacter = (c) => !!c && typeof c === 'object' && typeof c.MemberNumber !== 'undefined';
const mustNum = (v, d = 0) => (typeof v === 'number' && !isNaN(v) ? v : d);

/**
 * 引擎是否運作。兩個條件缺一不可：
 *   1. 使用者開了總開關 —— 沒開就完全不碰 BC 的表情系統。
 *   2. 引擎真的啟動了（已進過聊天室）—— 否則鉤子會吞掉表情變更卻沒有引擎能套用，
 *      表情就這樣憑空消失。未啟動時一律讓 BC 走自己的原生路徑。
 */
const engineOn = () => engineStarted && !!getFeature('animationEngine');

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

/**
 * 引擎套用完表情後，通知其他掛在 CharacterSetFacialExpression 上的模組。
 *
 * 引擎是直接寫 Player.Appearance（setExpression），不經過 CharacterSetFacialExpression，
 * 所以像「服装拓展」那種靠鉤子把 Eyes 鏡射到自家群組（左眼_Luzi/右眼_Luzi）的模組
 * 完全收不到通知 —— 手動點面板會動，但打屁股之類由引擎驅動的表情就不會鏡射。
 * 這裡補一通完整的鉤子鏈呼叫；notifying 期間我們自己的鉤子會放行（否則引擎的每個
 * 表情都會被自己當成手動覆寫再推回佇列，變成無窮迴圈）。
 *
 * 必須在 setExpression 之後呼叫：Property 已是目標值，BC 本體會在
 * `item.Property.Expression == Expression` 早退而不重複刷新，但排在我們前面的
 * 模組鉤子早已跑完 —— 通知到了，副作用是零。
 */
function notifyMods(t, expression, color) {
    if (notifying) return;
    notifying = true;
    try { CharacterSetFacialExpression(Player, t, expression, undefined, color); }
    catch (e) { console.warn(LOG, '通知其他模組表情變更失敗:', t, e); }
    finally { notifying = false; }
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

/**
 * 診斷用：在 console 執行 `Liko.LCE.debugExpressions(true)` 就會把
 * 「收到什麼活動訊息 / 有沒有配到觸發 / 最後套用了什麼表情」全部印出來。
 * 預設關閉，不影響效能。
 */
let debugOn = false;
export function debugExpressions(on = true) {
    debugOn = !!on;
    console.info(LOG, `表情診斷 ${debugOn ? '開啟' : '關閉'}`);
    return debugOn;
}
const dbg = (...a) => { if (debugOn) console.info(LOG, '[expr]', ...a); };

/** 收到聊天/活動訊息 → 比對觸發表 → 推送對應表情事件。 */
function handleChatMessage(data) {
    if (debugOn && (data?.Type === 'Activity' || data?.Type === 'Action')) {
        dbg('收到', data.Type, data.Content, 'Dictionary=', data.Dictionary);
    }
    if (!getFeature('activityExpressions')) { dbg('activityExpressions 關閉，略過'); return; }
    activityTriggers:
    for (const trigger of ActivityTriggers.filter(t => t.Type === data.Type)) {
        for (const matcher of trigger.Matchers) {
            if (!matcher.Tester.test(data.Content)) continue;
            dbg(`Tester 命中 ${trigger.Event}（${matcher.Tester}）`);
            if (matcher.Criteria) {
                if (matcher.Criteria.SenderIsPlayer && data.Sender !== Player.MemberNumber) { dbg('  ✗ SenderIsPlayer 不符'); continue; }
                if (matcher.Criteria.TargetIsPlayer && !dictHasPlayerTarget(data.Dictionary)) { dbg('  ✗ TargetIsPlayer 不符'); continue; }
                if (matcher.Criteria.DictionaryMatchers
                    && !matcher.Criteria.DictionaryMatchers.some(m => data.Dictionary?.find(t => Object.keys(m).every(k => m[k] === t[k])))) { dbg('  ✗ DictionaryMatchers 不符'); continue; }
                dbg(`  ✓ 推送事件 ${trigger.Event}`, EventExpressions[trigger.Event]);
                pushEvent(EventExpressions[trigger.Event]);
            } else if (data.Sender === Player.MemberNumber || dictHasPlayerTarget(data.Dictionary)) {
                dbg(`  ✓ 推送事件 ${trigger.Event}`, EventExpressions[trigger.Event]);
                pushEvent(EventExpressions[trigger.Event]);
                break activityTriggers;
            } else {
                dbg('  ✗ 玩家既不是發送者也不是目標');
            }
        }
    }
}

// ───────────────────────── 主引擎 ─────────────────────────
function customArousalExpression() {
    if (!engineOn() || !Player?.AppearanceLayers || !Player.ArousalSettings) return;
    if (!PreviousArousal) PreviousArousal = { ...Player.ArousalSettings };

    const faceParts = faceComponents();

    // 我們自己管理計時，清掉 BC 的移除計時器。
    // 只碰內建部位：模組新增的表情群組由該模組自己維護，它的計時器不歸我們管。
    Player.Appearance
        .filter(a => BASE_FACE_COMPONENTS.includes(a.Asset.Group.Name) && a.Property?.RemoveTimer)
        .forEach(a => { delete a.Property.RemoveTimer; });

    Player.ArousalSettings.AffectExpression = false;   // 取代 BC 原生的慾望表情

    const oCount = Player.ArousalSettings.OrgasmCount ?? 0;
    if (orgasmCount < oCount) orgasmCount = oCount;
    else if (orgasmCount > oCount) { Player.ArousalSettings.OrgasmCount = orgasmCount; ActivityChatRoomArousalSync(Player); }

    // 臉部完全恢復預設時，重設佇列（只看內建部位，模組群組不該讓佇列一直活著）
    let isDefault = true;
    for (const t of BASE_FACE_COMPONENTS) if (expression(t)[0]) isDefault = false;
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

    for (const t of faceParts) {
        // 內建部位一律由引擎作主：佇列沒東西就代表「該回到無表情」，強制歸零。
        // 但模組新增的表情群組（如 左眼_Luzi）不能這樣對待 —— 那些群組是該模組自己在
        // 維護的，它可能直接寫 Property 而從不經過我們的佇列。若比照內建部位歸零，
        // 引擎每 250ms 就會把它剛鏡射過去的表情擦掉。故：佇列裡真的有事件才寫，
        // 沒有就完全不碰。（若該模組是回頭呼叫 CharacterSetFacialExpression 來鏡射，
        // 事件會進佇列，這裡照樣套用得到 —— 兩種寫法都撐得住。）
        if (!nextExpression[t] && !BASE_FACE_COMPONENTS.includes(t)) continue;
        const [exp] = expression(t);
        const nextExp = nextExpression[t] || { Duration: -1, Expression: null };
        if (nextExp.Expression !== exp && typeof nextExp.Expression !== 'undefined') desiredExpression[t] = { ...nextExp };
    }

    // 套用表情
    if (Object.keys(desiredExpression).length > 0) {
        dbg('套用表情', JSON.parse(JSON.stringify(desiredExpression)), '佇列長度=', queue.length);
        let refreshScreen = false;
        for (const t of Object.keys(desiredExpression)) {
            if (bcxRule('block_changing_emoticon')?.isEnforced && t === 'Emoticon') continue;
            setExpression(t, desiredExpression[t].Expression ?? null, desiredExpression[t].Color);
            notifyMods(t, desiredExpression[t].Expression ?? null, desiredExpression[t].Color);
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

/**
 * BC 的兩個函式會「直接」改臉，繞過我們的佇列，必須改導進引擎（同 WCE）。
 * 這兩段是用 patchFunction 把 BC 原始碼裡的那一行換掉，取代碼跑在 BC 的全域範疇，
 * 所以引擎的入口要先掛到 window 上才叫得到。
 *
 *   TimerInventoryRemove
 *     BC 的限時表情到期時會直接呼叫 CharacterSetFacialExpression。不改導的話，
 *     BC 的計時器與我們的引擎會互相搶同一張臉 —— 引擎每 250ms 寫回自己的表情，
 *     BC 又把它清掉，結果就是活動表情（例如拍屁股的 Lewd 眼）看起來沒生效。
 *
 *   ValidationSanitizeProperties
 *     其他插件塞了非法表情時 BC 會 delete property.Expression，而引擎不知情、
 *     下一幀又寫回去，兩邊無限互踢。這裡通知引擎「這個部位已被清掉」。
 */
function installPatches() {
    try {
        // 供 patch 出來的程式碼呼叫（它們在 BC 的全域範疇執行，看不到模組作用域）
        window.lceAnimationEngineEnabled = engineOn;
        window.lcePushEvent = pushEvent;

        modApi.patchFunction('TimerInventoryRemove', {
            'CharacterSetFacialExpression(C, C.ExpressionQueue[0].Group, C.ExpressionQueue[0].Expression, undefined, undefined, true);':
            `if (window.lceAnimationEngineEnabled()) {
                window.lcePushEvent({
                    Type: "${GAME_TIMED_EVT}",
                    Duration: -1,
                    Expression: {
                        [C.ExpressionQueue[0].Group]: [{ Expression: C.ExpressionQueue[0].Expression, Duration: -1 }]
                    }
                });
            } else {
                CharacterSetFacialExpression(C, C.ExpressionQueue[0].Group, C.ExpressionQueue[0].Expression, undefined, undefined, true);
            }`,
        });

        modApi.patchFunction('ValidationSanitizeProperties', {
            'delete property.Expression;':
            `delete property.Expression;
            if (window.lceAnimationEngineEnabled()) {
                if (item?.Asset?.Group?.Name) {
                    CharacterSetFacialExpression(C, item.Asset.Group.Name, null);
                } else {
                    console.warn("🐈‍⬛ [LCE] 無法判斷物品的部位名稱", item);
                }
            }`,
        });
    } catch (e) {
        console.warn(LOG, '表情 patch 未套用（限時表情可能與引擎互搶）:', e?.message ?? e);
    }
}

let installed = false;

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
            Expression: faceComponents()
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

    installPatches();

    // 玩家手動改姿勢 → 記成手動覆寫。
    // 少了這段，引擎每 250ms 會把 ActivePose 打回預設的 BaseUpper/BaseLower，姿勢根本改不動。
    // 優先權見 ENGINE_HOOK_PRIORITY 的說明，勿調高。
    for (const poseFunc of ['CharacterSetActivePose', 'PoseSetActive']) {
        hook(poseFunc, ENGINE_HOOK_PRIORITY, (args, next) => {
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

    // 玩家手動改表情 → 記成手動覆寫，之後不被自動表情蓋掉。
    // 優先權見 ENGINE_HOOK_PRIORITY 的說明，勿調高。
    hook('CharacterSetFacialExpression', ENGINE_HOOK_PRIORITY, (args, next) => {
        let [C, AssetGroup, Expression, Timer, Color] = args;
        // notifying：這通是引擎自己發的通知（見 notifyMods），一律放行，不可再入佇列
        if (!isCharacter(C) || !isString(AssetGroup) || (!isString(Expression) && Expression !== null)
            || !C.IsPlayer() || !engineOn() || notifying) {
            return next(args);
        }
        const duration = typeof Timer === 'number' && Timer > 0 ? Timer * 1000 : -1;
        const e = {};

        // BC 的本體開頭會在 AssetGroup==="Eyes" 時遞迴呼叫自己處理 "Eyes2"（左眼帶右眼）。
        // 我們攔截後不呼叫 next，本體不再執行，這個遞迴就跟著消失 —— 排在我們前面的模組
        // （如「服装拓展」的 左眼_Luzi / 右眼_Luzi）只會收到 "Eyes"，於是只有左眼跟著變，
        // 右眼永遠停在原表情。這裡把遞迴補回來：走完整的鉤子鏈重新發一次 "Eyes2"，
        // 讓它們也收得到。"Eyes2" 不會再觸發這個分支，不會無限遞迴。
        // （WCE 直接把 Eyes2 併進 types 了事，只顧自己的兩眼，模組的右眼就是這樣被漏掉的。）
        if (AssetGroup === 'Eyes') CharacterSetFacialExpression(C, 'Eyes2', Expression, Timer, Color);

        // 上面那通已經連同鉤子鏈處理完 Eyes2，這裡只剩自己這一邊（比照 BC：Eyes1 即左眼）
        const types = AssetGroup === 'Eyes1' ? ['Eyes'] : [AssetGroup];
        if (!Color || !CommonColorIsValid(Color)) Color = undefined;
        for (const t of types) {
            e[t] = [{ Expression, Duration: duration, Color }];
            if (duration < 0) manualComponents[t] = Expression;
        }
        pushEvent({ Type: MANUAL_EVT, Duration: duration, Expression: e });
        return customArousalExpression();
    });
}
