import { createHook } from './hooks.js';

// 動畫用的發送預算閘門（低優先級）。
//
// BC 的 ServerSend 是「視窗限制」：每 interval(1200ms) 最多 limit(14) 則，超出的留在 client 端
// 佇列排隊（延遲，不丟失），而且聊天、表情、同步都排同一條。動畫逐格送封包，必須讓路給其他訊息。
// 這個模組只回答兩件事：「現在能不能提交一格動畫？」與「最早何時值得再問？」。
// 它不知道耳朵／尾巴／翅膀，動畫狀態與最終姿勢同步都留在 features/animal。
//
// 兩種負載訊號（不要混為一談）：
//   • 實際發送水位：BC 的 ServerSendRateLimitTimes / Queue。它們是頂層 let / const，不在 globalThis 上，
//     只能用裸識別字讀，且只算「選用訊號」，讀不到就不用。只有 ServerSocket.emit 才會寫進 Times，
//     所以這是真正送出的紀錄。
//   • 外部流量需求：ServerSend hook 看到的「呼叫」。呼叫時訊息可能還在佇列，不等於已送出，
//     所以只當作「別人也想送」的讓路訊號；BC 水位讀不到時才併入估算。
// 兩者都不可用時退回靜態保守預算（只算自己的提交）。

export const SEND_BUDGET_DEFAULTS = Object.freeze({
    limit: 14,        // BC ServerSendRateLimit 的預設
    interval: 1200,   // BC ServerSendRateLimitInterval 的預設
    reserve: 4,       // 留給聊天／表情等其他訊息的額度（起始值，之後看觀測數據調整）
    minGap: 100,      // 任兩次動畫提交之間的全域最小間隔
    queueRetry: 50,   // BC 佇列非空時，建議的重試間隔
});

const MAX_TRACKED = 64;

/** 讀 BC 的發送紀錄；任何一項不可用就回傳 null（呼叫端改走退回策略）。 */
function readBcState() {
    try {
        if (typeof ServerSendRateLimitQueue === 'undefined' || typeof ServerSendRateLimitTimes === 'undefined') return null;
        const times = ServerSendRateLimitTimes, queue = ServerSendRateLimitQueue;
        if (!Array.isArray(times) || !Array.isArray(queue)) return null;
        return {
            times, queueLength: queue.length,
            limit: globalThis.ServerSendRateLimit, interval: globalThis.ServerSendRateLimitInterval,
        };
    } catch { return null; }
}

const positive = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);

export function createSendBudget({ now = () => Date.now(), readBc = readBcState, ...options } = {}) {
    const cfg = { ...SEND_BUDGET_DEFAULTS, ...options };
    let ownTimes = [];      // 動畫自己成功提交的時間
    let demandTimes = [];   // 其他功能呼叫 ServerSend 的時間（呼叫，不是送出）
    let nextAt = 0;         // 全域最小間隔：最早何時可再提交
    let ownDepth = 0;       // >0 表示目前的 ServerSend 呼叫是動畫自己發的
    const stats = { mode: 'fallback', submitted: 0, deferrals: 0, timeouts: 0, finalFailed: 0, maxWaitMs: 0, maxQueue: 0 };   // mode: 最近一次判斷用的訊號來源 'bc' | 'fallback'

    const prune = (list, t, interval) => list.filter(x => t - x < interval).slice(-MAX_TRACKED);

    /** 回傳 { ok, at }：ok 為現在能否提交；at 為預估最早可再嘗試的時間（醒來後仍須重新檢查）。 */
    function evaluate() {
        const t = now();
        const bc = readBc();
        const interval = positive(bc?.interval, cfg.interval);
        const limit = positive(bc?.limit, cfg.limit);
        const budget = Math.max(1, limit - cfg.reserve);

        ownTimes = prune(ownTimes, t, interval);
        demandTimes = prune(demandTimes, t, interval);

        if (t < nextAt) return { ok: false, at: nextAt };

        // 其他功能剛剛才要求發送：讓它先走一個最小間隔
        const lastDemand = demandTimes[demandTimes.length - 1];
        if (lastDemand !== undefined && t - lastDemand < cfg.minGap) return { ok: false, at: lastDemand + cfg.minGap };

        stats.mode = bc ? 'bc' : 'fallback';
        let used;
        if (bc) {
            stats.maxQueue = Math.max(stats.maxQueue, bc.queueLength);
            if (bc.queueLength > 0) return { ok: false, at: t + cfg.queueRetry };
            used = bc.times.filter(x => t - x < interval);
        } else {
            // 退回模式：BC 的實際發送紀錄讀不到，這裡的數字是「估算」，不是實際送出數。
            // demandTimes 是 ServerSend「呼叫」，排隊中的訊息會在呼叫時就被計入，可能高估；
            // 繞過 ServerSend 直接 emit 的流量則看不到。刻意偏保守：寧可讓動畫慢一點，也不佔用其他訊息的額度。
            used = ownTimes.concat(demandTimes);
        }
        if (used.length >= budget) {
            used.sort((a, b) => a - b);
            // 等到最舊的幾筆離開視窗、空出一格
            return { ok: false, at: used[used.length - budget] + interval + 1 };
        }
        return { ok: true, at: t };
    }

    return {
        stats,
        config: cfg,
        /** 現在能不能提交一格動畫更新。只檢查，不佔用額度；提交成功後要呼叫 markSubmitted()。 */
        requestSlot: () => evaluate().ok,
        /** 預估最早何時值得再問（不是保證；醒來後要重新 requestSlot）。可用時回傳現在。 */
        nextAllowedAt: () => evaluate().at,
        /** 動畫已成功提交一格：記帳並啟動全域最小間隔。 */
        markSubmitted() {
            const t = now();
            ownTimes.push(t);
            nextAt = t + cfg.minGap;
            stats.submitted++;
        },
        /** 包住動畫自己的 ServerSend 呼叫，讓 hook 不把它當成外部需求。 */
        withOwnSend(fn) {
            ownDepth++;
            try { return fn(); } finally { ownDepth--; }
        },
        /** ServerSend hook 呼叫：非動畫的呼叫記為外部流量需求。 */
        noteServerSend() { if (ownDepth === 0) demandTimes.push(now()); },
        noteWait(ms) { stats.maxWaitMs = Math.max(stats.maxWaitMs, ms); },
        noteDeferral() { stats.deferrals++; },
        noteTimeout() { stats.timeouts++; },
        noteFinalFailed() { stats.finalFailed++; },
        reset() { ownTimes = []; demandTimes = []; nextAt = 0; ownDepth = 0; Object.assign(stats, { mode: 'fallback', submitted: 0, deferrals: 0, timeouts: 0, finalFailed: 0, maxWaitMs: 0, maxQueue: 0 }); },
    };
}

/** 全域共用的閘門；表情引擎等其他需要大量同步的功能之後也可以共用。 */
export const sendBudget = createSendBudget();

let hookInstalled = false;
/**
 * 掛上 ServerSend 觀察鉤子（只記帳、不改封包、不攔截，一律放行 next）。可重複呼叫。
 * 優先序刻意取中間值：只需要「看到呼叫」，不在乎與其他鉤子的先後。
 */
export function installSendBudgetHook(budget = sendBudget) {
    if (hookInstalled) return;
    hookInstalled = true;
    const hook = createHook('send-budget');
    hook('ServerSend', 50, (args, next) => {
        try { budget.noteServerSend(); } catch { /* 記帳失敗不影響送出 */ }
        return next(args);
    });
}
