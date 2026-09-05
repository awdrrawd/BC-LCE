import { deepCopy } from '../../core/util.js';
const AROUSAL_EVT = 'AutomatedByArousal';
const MANUAL_EVT = 'ManualOverride';

// Prepare an isolated queue entry; clock and IDs belong to the caller.
export function prepareExpressionEvent(evt, time, nextId) {
    const event = deepCopy(evt);

    // 雙眼同步：活動／事件類表情若只指定了單眼，補上另一眼，避免「一眼開一眼閉」。
    //   • 慾望分級（AROUSAL_EVT）本就以 Eyes / Eyes2 成對推送，且資料對稱 —— 不需處理。
    //   • 手動覆寫（MANUAL_EVT）已在 CharacterSetFacialExpression 鉤子鏡射過 —— 不重複。
    //   • 刻意單眼（如眨眼 Wink）以 SingleEye:true 標記，跳過鏡射。
    // 在 deepCopy 之後操作，才不會污染 EventExpressions / ArousalExpressionStages 這些共用常數。
    if (event.Expression && !event.SingleEye && event.Type !== AROUSAL_EVT && event.Type !== MANUAL_EVT) {
        const ex = event.Expression;
        if (ex.Eyes && !ex.Eyes2) ex.Eyes2 = deepCopy(ex.Eyes);
        else if (ex.Eyes2 && !ex.Eyes) ex.Eyes = deepCopy(ex.Eyes2);
    }

    event.At = time;
    event.Until = time + event.Duration;
    event.Id = nextId();
    if (typeof event.Priority !== 'number') event.Priority = 1;

    if (event.Expression) {
        for (const t of Object.values(event.Expression)) {
            for (const exp of t) {
                exp.Id = nextId();
                if (typeof exp.Priority !== 'number') exp.Priority = 1;
                if (typeof exp.Duration !== 'number') exp.Duration = event.Duration;
            }
        }
    }
    if (event.Poses) {
        for (const p of event.Poses) {
            p.Id = nextId();
            if (typeof p.Priority !== 'number') p.Priority = 1;
        }
    }
    return event;
}

/** Negative durations hold indefinitely; zero-duration entries are skipped. */
export function activeStepIndex(steps, elapsed) {
    for (let index = 0; index < steps.length; index++) {
        const duration = steps[index].Duration;
        elapsed -= duration;
        if (elapsed >= 0 && duration >= 0) continue;
        return index;
    }
    return -1;
}

export function isEventActive(event, now) {
    const until = event.Until ?? 0, at = event.At ?? 0;
    return until > now || until - at < 0;
}

// Resolve category conflicts on an isolated selection; never mutate queue entries.
export function resolvePoseConflicts(selection, categories) {
    const accepted = new Set();
    const entries = Object.entries(selection).sort((a, b) =>
        b[1].Priority - a[1].Priority || b[1].Id - a[1].Id);
    for (const [category] of entries) {
        const conflicts = categories[category]?.Conflicts ?? [];
        if ([...accepted].some(other => conflicts.includes(other)
            || (categories[other]?.Conflicts ?? []).includes(category))) continue;
        accepted.add(category);
    }
    return Object.fromEntries(Object.entries(selection).filter(([category]) => accepted.has(category)));
}
