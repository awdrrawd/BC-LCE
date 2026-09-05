/** Own only resources installed by this scope; disposal is idempotent. */
export function createScope() {
    const cleanups = new Set();
    let disposed = false;
    const add = cleanup => {
        if (typeof cleanup !== 'function') return;
        if (disposed) cleanup(); else cleanups.add(cleanup);
    };
    return {
        add,
        listen(target, type, listener, options) {
            if (!target || disposed) return;
            target.addEventListener(type, listener, options);
            add(() => target.removeEventListener(type, listener, options));
        },
        timeout(callback, delay) {
            if (disposed) return;
            const cleanup = () => clearTimeout(id);
            const id = setTimeout(() => { cleanups.delete(cleanup); if (!disposed) callback(); }, delay);
            add(cleanup);
        },
        frame(callback) {
            if (disposed) return;
            const cleanup = () => cancelAnimationFrame(id);
            const id = requestAnimationFrame(() => { cleanups.delete(cleanup); if (!disposed) callback(); });
            add(cleanup);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const cleanup of [...cleanups].reverse()) {
                try { cleanup(); } catch (error) { console.warn('🐈‍⬛ [LCE] cleanup:', error); }
            }
            cleanups.clear();
        },
    };
}

/** Rebind our handlers on a reused or replaced socket, never removing others' handlers. */
export function createSocketBinding(handlers) {
    let bound = null;
    const dispose = () => {
        if (bound) for (const [event, handler] of Object.entries(handlers)) bound.off(event, handler);
        bound = null;
    };
    return {
        bind(socket) {
            dispose();
            if (!socket?.on || !socket?.off) return;
            bound = socket;
            for (const [event, handler] of Object.entries(handlers)) bound.on(event, handler);
        },
        dispose,
    };
}

/** Catch synchronous and asynchronous installation failures without delaying unrelated features. */
export function runSafely(label, install) {
    const failed = error => console.warn('🐈‍⬛ [LCE]', `初始化步驟「${label}」失敗:`, error);
    try {
        const result = install();
        return result?.then ? Promise.resolve(result).catch(failed) : result;
    } catch (error) { failed(error); }
}
