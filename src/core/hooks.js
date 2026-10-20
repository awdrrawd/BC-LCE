import modApi from '../modsdk.js';

// 所有模組的掛鉤失敗彙整（key = label:name）。BC 改版時函式可能被改名/移除，
// 單看 console 很容易漏掉，所以集中起來給 /lce 與診斷 API 顯示。
const allFailures = new Map();

/** @returns {{feature: string, name: string, message: string}[]} 目前沒掛上的掛鉤 */
export function getHookFailures() {
    return Array.from(allFailures.values());
}

/** Register hooks without changing their priority or optional runtime ownership gate. */
export function createHook(label, enabled) {
    const failures = new Map();
    const register = (name, priority, callback) => {
        try {
            const cleanup = modApi.hookFunction(name, priority, enabled
                ? function (args, next) { return enabled() ? callback.apply(this, arguments) : next(args); }
                : callback);
            failures.delete(name);
            allFailures.delete(`${label}:${name}`);
            return cleanup;
        } catch (error) {
            failures.set(name, error);
            allFailures.set(`${label}:${name}`, { feature: label, name, message: String(error?.message ?? error) });
            console.warn('🐈‍⬛ [LCE]', label, 'hook 未掛上:', name, error?.message ?? error);
            return () => {};
        }
    };
    // Diagnostic snapshot: callers can detect partial installation without
    // changing the cleanup contract or aborting unrelated optional hooks.
    register.getFailures = () => Array.from(failures, ([name, error]) => ({ name, error }));
    return register;
}
