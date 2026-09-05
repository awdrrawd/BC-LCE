import modApi from '../modsdk.js';

/** Register hooks without changing their priority or optional runtime ownership gate. */
export function createHook(label, enabled) {
    const failures = new Map();
    const register = (name, priority, callback) => {
        try {
            const cleanup = modApi.hookFunction(name, priority, enabled
                ? (args, next) => enabled() ? callback(args, next) : next(args)
                : callback);
            failures.delete(name);
            return cleanup;
        } catch (error) {
            failures.set(name, error);
            console.warn('🐈‍⬛ [LCE]', label, 'hook 未掛上:', name, error?.message ?? error);
            return () => {};
        }
    };
    // Diagnostic snapshot: callers can detect partial installation without
    // changing the cleanup contract or aborting unrelated optional hooks.
    register.getFailures = () => Array.from(failures, ([name, error]) => ({ name, error }));
    return register;
}
